#!/usr/bin/env node
// Synthetic prompt/template diagnostic; never inference or wallet access.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadRagEvaluationRuntime, redactLocalPaths } from './rag-eval-runtime.mjs';
const args = process.argv.slice(2);
const value = key => args[args.indexOf(key) + 1];
assert.ok(args.includes('--output') && args.includes('--model-reference'));
const reference = JSON.parse(await readFile(value('--model-reference'), 'utf8'));
const endpoint = new URL('http://127.0.0.1:18083');
async function request(path, body) {
  const response = await fetch(new URL(path, endpoint), { method: body ? 'POST' : 'GET',
    redirect: 'error', signal: AbortSignal.timeout(15000),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `HTTP ${response.status}`);
  return response.json();
}
const props = await request('/props');
assert.equal(props.model_path, reference.model.server.data[0].id);
const modelHash = createHash('sha256').update(await readFile(props.model_path)).digest('hex');
assert.equal(modelHash, reference.model.sha256);
const entry = `
 export { buildAliceSystemPrompt, buildAliceLocalSystemPrompt, withAliceInstructionReminder } from './packages/alice-ai/src/ai-system-prompt.ts';
 export { fitMessagesToContextWithAsyncCounting, fitMessagesToEstimatedLocalContext } from './packages/alice-ai/src/local-context-budget.ts';
 export { fitLocalModelRoles } from './packages/alice-ai/src/local-model-message-policy.ts';`;
const current = await loadRagEvaluationRuntime(entry);
const baseline = await loadRagEvaluationRuntime(`export { buildAliceSystemPrompt, buildAliceLocalSystemPrompt } from './packages/alice-ai/src/ai-system-prompt.ts';`, { revision: 'a25b737b2037a19eb384996c309a4d1d24de5e65' });
const rows = [];
for (const language of ['en', 'fr']) for (const custom of ['', 'Answer with exactly one sentence.']) for (const longHistory of [false, true]) {
  const before = baseline.buildAliceLocalSystemPrompt(custom, language);
  const native = current.buildAliceLocalSystemPrompt(custom, language);
  assert.ok(native.startsWith(before));
  assert.equal(current.buildAliceSystemPrompt(custom, language), baseline.buildAliceSystemPrompt(custom, language));
  const evidence = (language === 'fr'
    ? 'Preuve synthétique. Le nœud vérifie les règles de consensus. '
    : 'Synthetic evidence. The node verifies consensus rules. ').repeat(200).slice(0, 6000);
  const history = longHistory ? [
    { role: 'user', content: 'Old synthetic question. '.repeat(1500) },
    { role: 'assistant', content: 'Old synthetic reply. '.repeat(1500) },
  ] : [];
  const messages = [{ role: 'system', content: native }, ...current.withAliceInstructionReminder([
    { role: 'system', content: evidence }, ...history,
    { role: 'system', content: 'Synthetic profile: beginner, no personal wallet data.' },
    { role: 'user', content: language === 'fr' ? 'Explique les preuves fournies.' : 'Explain the supplied evidence.' },
  ], custom, language)];
  const original = structuredClone(messages);
  const measurements = [];
  let rendered;
  const fitted = await current.fitMessagesToContextWithAsyncCounting(messages, 768, 4096, async candidate => {
    rendered = (await request('/apply-template', { messages: candidate, chat_template_kwargs: { enable_thinking: false } })).prompt;
    const tokens = (await request('/tokenize', { content: rendered, add_special: false, parse_special: true })).tokens.length;
    measurements.push({ messages: candidate.length, tokens });
    return tokens;
  }, candidate => current.fitLocalModelRoles(candidate, 'qwen3-1.7b'));
  assert.deepEqual(messages, original);
  for (const message of messages.filter(message => message.role === 'system').concat(messages.at(-1))) {
    assert.ok(fitted.messages.some(item => item.content === message.content));
    assert.ok(rendered.includes(message.content));
  }
  assert.equal(fitted.messages.some(message => message.content.startsWith('Old synthetic')), false);
  assert.equal(fitted.responseTokens, 768);
  assert.ok(fitted.promptTokens + fitted.responseTokens + 64 <= 4096);
  rows.push({ language, custom, longHistory, nativeCharsBefore: before.length, nativeCharsAfter: native.length,
    desktopUnchanged: true, originalNativePrefixPreserved: true, measurements, fitted, renderedPrompt: rendered });
}
let rejected = false;
try {
  await current.fitMessagesToContextWithAsyncCounting([
    { role: 'system', content: 'Mandatory evidence. '.repeat(6000) },
    { role: 'user', content: 'Current synthetic question.' },
  ], 768, 4096, async messages => {
    const { prompt } = await request('/apply-template', { messages, chat_template_kwargs: { enable_thinking: false } });
    return (await request('/tokenize', { content: prompt, add_special: false, parse_special: true })).tokens.length;
  });
} catch (error) { assert.match(error.message, /Local prompt is too long/); rejected = true; }
assert.ok(rejected);
const output = { date: new Date().toISOString(), passed: true,
  methodology: 'Synthetic 6000-character evidence, FR/EN with/without custom style and long history. Shared native fitter with actual Qwen llama-server template/tokenizer on Mac, answer-only, add_special=false/parse_special=true. All original system contexts and final user text retained verbatim; old pairs removed; 4096 context/768 response/64 margin unchanged. Desktop/cloud assembled policy equality against a25b737b. No inference, Android SDK/device, latency, quality, arbitrary-text capacity or other-model proof.',
  modelPath: props.model_path, modelSha256: modelHash, serverBuild: props.build_info,
  irreducibleContextRejected: rejected, rows };
await writeFile(value('--output'), JSON.stringify(redactLocalPaths(output), null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: true, rows: rows.length, promptTokens: rows.map(row => row.fitted.promptTokens), irreducibleContextRejected: rejected }));
