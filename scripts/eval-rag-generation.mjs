#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { loadRagEvaluationRuntime, redactLocalPaths } from './rag-eval-runtime.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const fixturePath = value('--fixture');
const outputPath = value('--output');
const modelId = value('--model');
const modelPath = value('--model-file');
assert.ok(fixturePath && outputPath && modelId && modelPath, 'Require --fixture, --output, --model and --model-file');
const endpoint = new URL(value('--endpoint', 'http://127.0.0.1:18083'));
assert.equal(endpoint.protocol, 'http:');
assert.equal(endpoint.hostname, '127.0.0.1', 'Only isolated loopback inference is permitted');
assert.equal(endpoint.pathname, '/');
assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash);
const preset = value('--preset', 'balanced');
assert.ok(['fast', 'balanced', 'deep'].includes(preset));
const limit = Number(value('--limit', '0'));
assert.ok(Number.isInteger(limit) && limit >= 0);
// Evaluation-only: bypass corpus retrieval with fixture-supplied context to test
// composition/generation against injected evidence, never retrieval ranking.
const syntheticKnowledgeMode = args.includes('--synthetic-knowledge');
// Evaluation-only: send the production pedagogical block for a fresh,
// in-memory profile instead of the historical empty string. Off by default so
// earlier baselines stay comparable; record it with every run.
const productionPedagogy = args.includes('--production-pedagogy');
// Evaluation-only: load the application sources of an earlier commit (the
// harness file itself stays current) so both arms of a paired run share the
// same harness, engine and flags and differ only in application code.
const revisionArg = value('--revision', null);
assert.ok(!revisionArg || /^[0-9a-f]{7,40}$/.test(revisionArg), '--revision must be a commit hash');
const codeRevision = revisionArg ? execFileSync('git', ['rev-parse', `${revisionArg}^{commit}`], { encoding: 'utf8' }).trim() : null;
const fixtureBytes = await readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes);
assert.ok(Array.isArray(fixture.cases) && fixture.cases.length > 0);
assert.equal(new Set(fixture.cases.map(row => row.id)).size, fixture.cases.length);
for (const row of fixture.cases) {
  assert.ok(row.question && ['fr', 'en'].includes(row.language) && Array.isArray(row.history));
  assert.ok(Array.isArray(row.mustCover) && Array.isArray(row.mustNotClaim));
  if (syntheticKnowledgeMode) {
    assert.ok(row.syntheticKnowledge && typeof row.syntheticKnowledge === 'object', `Row ${row.id} missing syntheticKnowledge under --synthetic-knowledge`);
    const keys = Object.keys(row.syntheticKnowledge);
    assert.ok(keys.every(key => key === 'ragContext' || key === 'learnContext'), `Row ${row.id} syntheticKnowledge may only contain ragContext and learnContext`);
    assert.equal(typeof row.syntheticKnowledge.ragContext, 'string', `Row ${row.id} syntheticKnowledge.ragContext must be a nonempty string`);
    assert.ok(row.syntheticKnowledge.ragContext.trim().length > 0, `Row ${row.id} syntheticKnowledge.ragContext must be a nonempty string`);
    assert.ok(row.syntheticKnowledge.learnContext === undefined || row.syntheticKnowledge.learnContext === null || typeof row.syntheticKnowledge.learnContext === 'string', `Row ${row.id} syntheticKnowledge.learnContext must be null or a string`);
  } else {
    assert.ok(row.syntheticKnowledge === undefined, `Row ${row.id} provides syntheticKnowledge without --synthetic-knowledge`);
  }
}
const selected = limit ? fixture.cases.slice(0, limit) : fixture.cases;
const learnRoot = value('--learn-root', null);
assert.ok(!syntheticKnowledgeMode || !learnRoot, 'Synthetic context cannot be combined with --learn-root');
const originalFetch = globalThis.fetch;
let requests = [];
let verifiedServerModelId = null;
globalThis.fetch = async (url, options) => {
  if (learnRoot && typeof url === 'string' && url.startsWith('/learn/')) {
    const path = resolve(learnRoot, url.slice('/learn/'.length));
    assert.ok(!relative(resolve(learnRoot), path).startsWith('..'));
    try { return new Response(await readFile(path), { status: 200 }); }
    catch { return new Response('', { status: 404 }); }
  }
  const target = new URL(String(url));
  assert.equal(target.origin, 'http://localhost:11435', 'Unexpected backend destination');
  assert.ok(['/v1/models', '/v1/chat/completions'].includes(target.pathname));
  let safeOptions = options;
  if (target.pathname === '/v1/chat/completions') {
    const body = JSON.parse(options.body);
    // Recorded evaluation-only controls; actual model/preset/prompt/budget
    // come from the production backend, including its language retry.
    assert.ok(verifiedServerModelId, 'Model identity has not been checked');
    assert.equal(body.model, 'local', 'Unexpected production backend model selector');
    body.model = verifiedServerModelId;
    body.seed = 42;
    body.cache_prompt = false;
    requests.push(body);
    safeOptions = { ...options, body: JSON.stringify(body) };
  }
  return originalFetch(new URL(target.pathname, endpoint), { ...safeOptions, redirect: 'error', signal: AbortSignal.timeout(180_000) });
};
const runtime = await loadRagEvaluationRuntime(`
 export { prepareAliceTurn } from './packages/alice-ai/src/turn-engine.ts';
 export { createAliceMemory } from './packages/alice-ai/src/alice-memory-core.ts';
 export { createPedagogicalProfile, pedagogicalContext } from './packages/alice-ai/src/pedagogical-profile-core.ts';
 export { loadRagCorpus, buildRagTurnContext, isTechnicalRagQuery } from './packages/alice-ai/src/rag.ts';
 export { ragQueryChunkBudget } from './packages/alice-ai/src/rag-query-policy.ts';
 export { knowledgeContextCharLimit } from './packages/alice-ai/src/knowledge-context-budget.ts';
 export { LocalDesktopAIBackend } from './packages/alice-ai/src/ai-backend-local-desktop.ts';
 export { generateLanguageChecked } from './packages/alice-ai/src/language-generation.ts';
 export { getModelEntry } from './packages/alice-ai/src/ai-preferences.ts';
 ${learnRoot ? "export { registerLearnTurnContext } from './apps/app-web/src/lib/learn/turn-context.ts';" : ''}
`, { revision: codeRevision ?? undefined, evaluationPreferences: { alice_ai_preset_local: preset, alice_ai_local_model: modelId } });
if (syntheticKnowledgeMode) {
  const knowledgeCap = runtime.knowledgeContextCharLimit(true);
  for (const row of selected) {
    const combinedLength = row.syntheticKnowledge.ragContext.length + (row.syntheticKnowledge.learnContext?.length ?? 0);
    assert.ok(combinedLength <= knowledgeCap, `Row ${row.id} syntheticKnowledge exceeds the ${knowledgeCap}-char local knowledge cap`);
  }
}
const entry = runtime.getModelEntry(modelId);
assert.equal(entry?.id, modelId, 'Unknown production model');
assert.equal((await stat(modelPath)).size, entry.sizeBytes, 'Model size differs from the app catalog');
const modelDigest = createHash('sha256');
for await (const chunk of createReadStream(modelPath)) modelDigest.update(chunk);
const modelHash = modelDigest.digest('hex');
const modelsResponse = await originalFetch(new URL('/v1/models', endpoint), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
assert.ok(modelsResponse.ok);
const models = await modelsResponse.json();
assert.equal(models.data?.length, 1, 'Require a single-model isolated server');
assert.equal(models.data[0].id, resolve(modelPath), 'Server model path differs from the hashed file');
verifiedServerModelId = models.data[0].id;
if (!syntheticKnowledgeMode) {
  await runtime.loadRagCorpus();
  if (learnRoot) runtime.registerLearnTurnContext();
}
const backend = new runtime.LocalDesktopAIBackend();
await backend.init();
assert.equal(backend.status().state, 'ready');
let calls = [];
const sendMessage = backend.sendMessage.bind(backend);
backend.sendMessage = async (messages, onChunk, options) => {
  const started = performance.now();
  let firstTokenMs = null;
  try {
    const result = await sendMessage(messages, delta => {
      if (delta) firstTokenMs ??= performance.now() - started;
      onChunk?.(delta);
    }, options);
    calls.push({ firstTokenMs, durationMs: performance.now() - started, truncated: result.truncated, usage: result.usage });
    return result;
  } catch (error) {
    calls.push({ firstTokenMs, durationMs: performance.now() - started, error: String(error) });
    throw error;
  }
};
const report = {
  startedAt: new Date().toISOString(), completedAt: null, status: 'running',
  methodology: 'Development generation through actual desktop backend, prepareAliceTurn, local context fit and generateLanguageChecked. Lexical retrieval; optional Web Learn provider. Storage/preferences/pedagogy isolated in memory. No wallet data, network services, native Android or cloud inference. Exact single-server model path selector, seed 42 and cache_prompt=false are evaluation-only transport controls. Redirects are forbidden. Identity is observed from a caller-owned server process and model path/hash, not remote cryptographic attestation. No automatic factual score: exact answers require rubric review. First raw token and first visible display are separate; no paired latency acceptance is claimed.'
    + (productionPedagogy ? ' PRODUCTION-PEDAGOGY: the pedagogical block of a fresh in-memory profile is sent instead of an empty string.' : '')
    + (syntheticKnowledgeMode ? ' SYNTHETIC-KNOWLEDGE-OVERRIDE: corpus retrieval was bypassed and fixture-supplied ragContext/learnContext were injected directly; these rows exercise prompt composition and generation only, not retrieval ranking or corpus relevance.' : ''),
  knowledgeMode: syntheticKnowledgeMode ? 'synthetic-knowledge-override' : 'production-retrieval',
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  codeRevision: codeRevision ?? 'working-tree',
  gitStatus: execFileSync('git', ['status', '--short', '--untracked-files=all'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  harnessSources: Object.fromEntries(await Promise.all(['scripts/eval-rag-generation.mjs', 'scripts/rag-eval-runtime.mjs'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')]))),
  fixturePath, fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  model: { id: modelId, filename: entry.filename, sizeBytes: entry.sizeBytes, sha256: modelHash, server: models },
  preset, seed: 42, learnEnabled: Boolean(learnRoot), productionPedagogy, expectedCases: selected.length,
  generatedAnswers: 0, directAnswers: 0, errors: 0, rows: [],
};
// Never accidentally overwrite a previous evidence run.
await writeFile(outputPath, JSON.stringify(redactLocalPaths(report), null, 2) + '\n', { flag: 'wx' });
for (const row of selected) {
  requests = []; calls = [];
  let context = null;
  const started = performance.now();
  const result = { id: row.id, language: row.language, question: row.question, history: row.history,
    rubric: { mustCover: row.mustCover, mustNotClaim: row.mustNotClaim, critical: row.critical }, review: null,
    knowledgeSource: syntheticKnowledgeMode ? 'synthetic-knowledge-override' : 'production-retrieval' };
  try {
    const prepared = await runtime.prepareAliceTurn({ history: [...row.history, { role: 'user', content: row.question }], userMessage: row.question, backendType: 'local', targetLanguage: row.language }, {
      recordPedagogicalSignal: async () => runtime.createPedagogicalProfile(),
      getMemory: async () => ({ ...runtime.createAliceMemory(), enabled: false }),
      rememberMemoryCandidates: async () => ({ memory: { ...runtime.createAliceMemory(), enabled: false }, saved: true }),
      pedagogicalContext: productionPedagogy ? runtime.pedagogicalContext : () => '', memoryContext: () => '', memoryCaptureInstruction: '',
      retrieveKnowledge: async query => {
        if (syntheticKnowledgeMode) {
          context = { ragContext: row.syntheticKnowledge.ragContext, learnContext: row.syntheticKnowledge.learnContext ?? null, localContext: null, diagnostics: [] };
          return context;
        }
        context = await runtime.buildRagTurnContext(query, undefined, { maxChunks: runtime.ragQueryChunkBudget(query, true, () => runtime.isTechnicalRagQuery(query)), targetLanguage: row.language, maxContextChars: runtime.knowledgeContextCharLimit(true) });
        return context;
      },
    });
    result.diagnostics = prepared.diagnostics;
    result.context = context;
    if (prepared.directResponse !== null) {
      assert.ok(!syntheticKnowledgeMode, `Row ${row.id} produced a direct response under --synthetic-knowledge; refusing, as it never exercises injected evidence`);
      result.source = 'direct-response'; result.answer = prepared.directResponse; report.directAnswers++;
    } else {
      assert.ok(!syntheticKnowledgeMode || context?.ragContext, `Row ${row.id} never requested synthetic evidence`);
      const generated = await runtime.generateLanguageChecked({ backend, history: prepared.history, allowContinuation: false, targetLanguage: row.language, onText: () => {} });
      if (syntheticKnowledgeMode) {
        assert.ok(requests.length > 0 && requests.every(request => request.messages.some(message => message.content.includes(context.ragContext))), `Row ${row.id} lost synthetic RAG text during prompt fitting`);
        if (context.learnContext) assert.ok(requests.every(request => request.messages.some(message => message.content.includes(context.learnContext))), `Row ${row.id} lost synthetic Learn text during prompt fitting`);
      }
      result.source = 'model'; result.answer = generated.text; result.generation = generated; report.generatedAnswers++;
    }
  } catch (error) { result.error = String(error); report.errors++; }
  result.durationMs = performance.now() - started;
  result.calls = calls; result.requests = requests;
  report.rows.push(result);
  await writeFile(outputPath, JSON.stringify(redactLocalPaths(report), null, 2) + '\n');
  console.log(JSON.stringify({ id: row.id, source: result.source, error: result.error, chars: result.answer?.length, durationMs: Math.round(result.durationMs) }));
}
report.status = report.errors ? 'completed-with-errors' : 'completed';
report.completedAt = new Date().toISOString();
await writeFile(outputPath, JSON.stringify(redactLocalPaths(report), null, 2) + '\n');
// Do not dispose the production backend: that would request Tauri shutdown.
// The caller owns the isolated server process and stops it explicitly.
process.exitCode = report.errors ? 1 : 0;
