#!/usr/bin/env node
// Request capture only: NO inference, NO answer. Runs the same production
// path as eval-rag-generation.mjs (prepareAliceTurn, lexical retrieval,
// optional Learn, desktop backend, context fit) and records the first
// /v1/chat/completions body the backend would send to llama-server. Used to
// prove which prompts a change alters before paying for real generations, and
// to compare a historical revision with the working tree at constant inputs.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { loadRagEvaluationRuntime, redactLocalPaths } from './rag-eval-runtime.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const fixturePaths = args.flatMap((arg, index) => arg === '--fixture' ? [args[index + 1]] : []);
const outputPath = value('--output');
const modelId = value('--model', 'qwen3-1.7b');
const revision = value('--revision', null);
const preset = value('--preset', 'balanced');
const learnRoot = value('--learn-root', null);
const productionPedagogy = args.includes('--production-pedagogy');
assert.ok(fixturePaths.length > 0 && outputPath, 'Require at least one --fixture and --output');
assert.ok(!revision || /^[0-9a-f]{7,40}$/.test(revision), '--revision must be a commit hash');
const revisionHead = revision ? execFileSync('git', ['rev-parse', `${revision}^{commit}`], { encoding: 'utf8' }).trim() : null;

const fixtures = [];
for (const path of fixturePaths) {
  const bytes = await readFile(path);
  const fixture = JSON.parse(bytes);
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length > 0);
  for (const row of fixture.cases) assert.ok(row.syntheticKnowledge === undefined, `${path}:${row.id} needs --synthetic-knowledge, unsupported here`);
  fixtures.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), cases: fixture.cases });
}

class CaptureComplete extends Error {}
const originalFetch = globalThis.fetch;
let captured = null;
globalThis.fetch = async (url, options) => {
  if (learnRoot && typeof url === 'string' && url.startsWith('/learn/')) {
    const path = resolve(learnRoot, url.slice('/learn/'.length));
    assert.ok(!relative(resolve(learnRoot), path).startsWith('..'));
    try { return new Response(await readFile(path), { status: 200 }); }
    catch { return new Response('', { status: 404 }); }
  }
  const target = new URL(String(url));
  assert.equal(target.origin, 'http://localhost:11435', 'Unexpected backend destination');
  // The backend only needs a ready local server; nothing is ever generated.
  if (target.pathname === '/v1/models') return new Response(JSON.stringify({ data: [{ id: 'capture-only' }] }), { status: 200 });
  assert.equal(target.pathname, '/v1/chat/completions');
  captured = JSON.parse(options.body);
  throw new CaptureComplete('request captured');
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
 ${learnRoot ? "export { registerLearnTurnContext } from './apps/app-web/src/lib/learn/turn-context.ts';" : ''}
`, { revision: revisionHead ?? undefined, evaluationPreferences: { alice_ai_preset_local: preset, alice_ai_local_model: modelId } });
await runtime.loadRagCorpus();
if (learnRoot) runtime.registerLearnTurnContext();
const backend = new runtime.LocalDesktopAIBackend();
await backend.init();
assert.equal(backend.status().state, 'ready');

const report = {
  kind: 'request-capture-only',
  methodology: 'No inference and no answers. Same prepareAliceTurn services as eval-rag-generation.mjs (memory isolated; pedagogy empty unless --production-pedagogy), lexical retrieval, optional Learn, desktop backend and context fit. Records the first chat-completions body only; language retries are not exercised. Not generation-quality evidence.',
  createdAt: new Date().toISOString(),
  codeRevision: revisionHead ?? 'working-tree',
  workingTreeHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  gitStatus: execFileSync('git', ['status', '--short', '--untracked-files=all'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  scriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  model: modelId, preset, learnEnabled: Boolean(learnRoot), productionPedagogy,
  fixtures: fixtures.map(({ path, sha256, cases }) => ({ path, sha256, cases: cases.length })),
  rows: [],
};
for (const fixture of fixtures) {
  for (const row of fixture.cases) {
    captured = null;
    let context = null;
    const prepared = await runtime.prepareAliceTurn({ history: [...row.history, { role: 'user', content: row.question }], userMessage: row.question, backendType: 'local', targetLanguage: row.language }, {
      recordPedagogicalSignal: async () => runtime.createPedagogicalProfile(),
      getMemory: async () => ({ ...runtime.createAliceMemory(), enabled: false }),
      rememberMemoryCandidates: async () => ({ memory: { ...runtime.createAliceMemory(), enabled: false }, saved: true }),
      pedagogicalContext: productionPedagogy ? runtime.pedagogicalContext : () => '', memoryContext: () => '', memoryCaptureInstruction: '',
      retrieveKnowledge: async query => {
        context = await runtime.buildRagTurnContext(query, undefined, { maxChunks: runtime.ragQueryChunkBudget(query, true, () => runtime.isTechnicalRagQuery(query)), targetLanguage: row.language, maxContextChars: runtime.knowledgeContextCharLimit(true) });
        return context;
      },
    });
    const result = { fixture: fixture.path, id: row.id, language: row.language, question: row.question, kind: prepared.diagnostics.kind, retrievedChunkIds: prepared.diagnostics.retrievedChunkIds };
    if (prepared.directResponse !== null) {
      result.source = 'direct-response';
      result.directResponse = prepared.directResponse;
    } else {
      try {
        await runtime.generateLanguageChecked({ backend, history: prepared.history, allowContinuation: false, targetLanguage: row.language, onText: () => {} });
        assert.fail(`${row.id} produced text without a model`);
      } catch (error) {
        if (!(error instanceof CaptureComplete) && !String(error).includes('request captured')) throw error;
      }
      assert.ok(captured, `${row.id} sent no request`);
      result.source = 'model-request';
      result.request = captured;
      result.requestSha256 = createHash('sha256').update(JSON.stringify(captured)).digest('hex');
    }
    report.rows.push(result);
  }
}
await writeFile(outputPath, JSON.stringify(redactLocalPaths(report), null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output: outputPath, codeRevision: report.codeRevision, rows: report.rows.length, modelRequests: report.rows.filter(row => row.source === 'model-request').length }));
globalThis.fetch = originalFetch;
