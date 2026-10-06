#!/usr/bin/env node
// A self-match only checks index/runtime agreement, not faithful tokenization.
// Compare synthetic FR/EN probes with the offline ONNX reference before accepting
// a native model or rebuilding its index. No user text or remote inference.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pipeline, env } from '@huggingface/transformers';

const args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const endpoint = value('--endpoint', 'http://127.0.0.1:18082');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname), 'Diagnostic inference must remain on localhost');
const cache = value('--model-cache', null);
assert.ok(cache, 'Pass --model-cache for the existing offline ONNX reference');
env.allowRemoteModels = false;
env.cacheDir = cache;
const referenceModel = 'Xenova/multilingual-e5-small';
const extractor = await pipeline('feature-extraction', referenceModel, { local_files_only: true });
const cosine = (a, b) => {
  assert.equal(a.length, 384);
  assert.equal(b.length, 384);
  const result = a.reduce((sum, n, i) => sum + n * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
  assert.ok(Number.isFinite(result));
  return result;
};
async function request(path, body) {
  const response = await fetch(`${endpoint}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, `Local model returned HTTP ${response.status}`);
  return response.json();
}
const probes = [
  'query: What is Bitcoin?',
  'query: Pourquoi utiliser un nœud complet ?',
  'passage: A full node verifies consensus rules independently.',
];
const rows = [];
try {
  for (const text of probes) {
    const referenceTokens = Array.from(extractor.tokenizer(text).input_ids.data, Number);
    const { tokens: nativeTokens } = await request('/tokenize', { content: text, add_special: true });
    const reference = Array.from((await extractor([text], { pooling: 'mean', normalize: true })).data);
    const ordinary = await request('/v1/embeddings', { input: [text] });
    // Same weights, reference token IDs: separates a tokenizer error from a
    // numerical/weight/architecture discrepancy on these probes.
    const forced = await request('/v1/embeddings', { input: [referenceTokens] });
    rows.push({ text, referenceTokens, nativeTokens,
      tokenParity: JSON.stringify(referenceTokens) === JSON.stringify(nativeTokens),
      ordinaryCosine: cosine(reference, ordinary.data[0].embedding),
      referenceTokenCosine: cosine(reference, forced.data[0].embedding),
    });
  }
} finally { await extractor.dispose(); }
const passed = rows.every(row => row.tokenParity && row.ordinaryCosine >= 0.99);
const report = { referenceModel, endpoint, minimumCosine: 0.99, passed,
  limitation: 'Three synthetic probes only; not retrieval quality, all-token fidelity or Android runtime/performance acceptance.', rows };
const output = value('--output', null);
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
