import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRagEvaluationRuntime } from '../../../scripts/rag-eval-runtime.mjs';

test('the production RAG bridge forwards response language and quotes Learn separately', async () => {
  const runtime = await loadRagEvaluationRuntime(`
    export { buildRagTurnContext } from './packages/alice-ai/src/rag.ts';
    export { registerLearnContextProvider } from './packages/alice-ai/src/learn-context.ts';
    export { composeGenerationHistory } from './packages/alice-ai/src/generation-context.ts';
  `);
  runtime.registerLearnContextProvider(async (query: string, options: { targetLanguage?: string }) => {
    assert.equal(query, 'What is Bitcoin?');
    assert.equal(options?.targetLanguage, 'fr');
    return { label: 'Les bases', excerpt: 'Un réseau monétaire sans autorité centrale.' };
  });
  const context = await runtime.buildRagTurnContext('What is Bitcoin?', undefined, { maxChunks: 1, targetLanguage: 'fr' });
  assert.equal(context.learnContext, 'Les bases\nUn réseau monétaire sans autorité centrale.');
  assert.equal(context.diagnostics[0]?.id, 'bitcoin-basics');
  const history = runtime.composeGenerationHistory([{ role: 'user', content: 'What is Bitcoin?' }], context, '');
  assert.equal(history.at(-1).content, 'What is Bitcoin?');
  assert.ok(history.some((m: { role: string; content: string }) => m.role === 'system' && m.content.includes('Les bases')));
});


test('RAG stage timings preserve parallel Learn and semantic work without query text', { timeout: 3000 }, async () => {
  const runtime = await loadRagEvaluationRuntime(`
    export { buildRagTurnContext } from './packages/alice-ai/src/rag.ts';
    export { registerLearnContextProvider } from './packages/alice-ai/src/learn-context.ts';
  `);
  let releaseLearn!: () => void;
  const semanticStarted = new Promise<void>(resolve => { releaseLearn = resolve; });
  let releaseSemantic!: () => void;
  const learnStarted = new Promise<void>(resolve => { releaseSemantic = resolve; });
  runtime.registerLearnContextProvider(async () => {
    releaseSemantic();
    // Each stage waits for the other to start, enforcing parallel execution.
    await semanticStarted;
    return { label: 'Course', excerpt: 'Parallel context.' };
  });
  runtime.setEvaluationSemanticMatcher(async () => { releaseLearn(); await learnStarted; return null; });
  const context = await runtime.buildRagTurnContext('What is Bitcoin?', undefined, { maxChunks: 1 });
  assert.equal(context.learnContext, 'Course\nParallel context.');
  for (const value of Object.values(context.timingMs)) {
    assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0);
  }
  assert.ok(context.timingMs.total >= context.timingMs.semantic);
  assert.ok(context.timingMs.total >= context.timingMs.learn);
  assert.doesNotMatch(JSON.stringify(context.timingMs), /Bitcoin|What is/);
});


test('the actual RAG + Learn bridge shares a hard text budget and reports only emitted notes', async () => {
  const runtime = await loadRagEvaluationRuntime(`
    export { buildRagTurnContext } from './packages/alice-ai/src/rag.ts';
    export { registerLearnContextProvider } from './packages/alice-ai/src/learn-context.ts';
    export { getAllChunks } from './packages/alice-ai/src/knowledge-packs.ts';
  `);
  const full = await runtime.buildRagTurnContext('What is Bitcoin?', undefined, {maxChunks:1});
  const content = runtime.getAllChunks().find((c: {id:string}) => c.id === 'bitcoin-basics').content;
  runtime.registerLearnContextProvider(async () => ({label:'Course', excerpt:content}));
  const duplicate = await runtime.buildRagTurnContext('What is Bitcoin?', undefined, {maxChunks:1});
  assert.equal(duplicate.learnContext, null);
  assert.deepEqual(duplicate.diagnostics, full.diagnostics);
  runtime.registerLearnContextProvider(async () => ({label:'Course', excerpt:'An additional, complete paragraph. No guarantee is implied.'}));
  const capped = await runtime.buildRagTurnContext('What is Bitcoin?', undefined, {
    maxChunks:1, maxContextChars:full.ragContext.length + 20,
  });
  assert.equal(capped.ragContext, full.ragContext);
  assert.equal(capped.learnContext, null);
  const tiny = await runtime.buildRagTurnContext('What is Bitcoin?', undefined, {maxChunks:1,maxContextChars:100});
  assert.equal(tiny.ragContext, null);
  assert.deepEqual(tiny.diagnostics, []);
  assert.ok(tiny.learnContext.includes('No guarantee is implied.'));
  assert.ok(tiny.learnContext.length <= 100);
});
