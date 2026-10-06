#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { loadRagEvaluationRuntime, redactLocalPaths } from './rag-eval-runtime.mjs';

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const semantic = value('--semantic', 'off');
assert.ok(['off', 'web', 'native'].includes(semantic));
const baselineRef = value('--baseline-ref', 'c84fc611');
const semanticIndexDir = value('--semantic-index-dir', null);
// Corpus/model changes must be evaluated against their own matching index.
// Compare this standalone report with a preserved historical report afterwards.
const candidateOnly = args.includes('--candidate-only');
assert.ok(!semanticIndexDir || semantic !== 'off', 'An index override requires an explicit semantic mode');
const fixturePath = value('--fixture', 'scripts/data/rag-query-eval/questions.json');
const fixtureBytes = await readFile(fixturePath);
const profileRepeats = Number(value('--profile-repeats', '0'));
assert.ok(Number.isInteger(profileRepeats) && profileRepeats >= 0 && profileRepeats <= 100);
const profiling = profileRepeats > 0;
const fixture = JSON.parse(fixtureBytes);
const goldReviewPath = value('--gold-review', null);
let goldReviewSha256 = null;
if (goldReviewPath) {
  const reviewBytes = await readFile(goldReviewPath);
  const review = JSON.parse(reviewBytes);
  assert.equal(review.fixtureSha256, createHash('sha256').update(fixtureBytes).digest('hex'), 'Gold review targets another fixture');
  goldReviewSha256 = createHash('sha256').update(reviewBytes).digest('hex');
  for (const [id, entry] of Object.entries(review.cases)) {
    const row = fixture.cases.find(row => row.id === id);
    assert.ok(row, `Unknown reviewed case: ${id}`);
    row.relevantConceptGroups = entry.relevantConceptGroups;
  }
}

const learnRoot = value('--learn-root', null);
const originalFetch = globalThis.fetch;
let packReads = [];
if (learnRoot) globalThis.fetch = async (url, options) => {
  if (typeof url === 'string' && url.startsWith('/learn/')) {
    const path = resolve(learnRoot, url.slice('/learn/'.length));
    assert.ok(!relative(resolve(learnRoot), path).startsWith('..'));
    packReads.push(url);
    try { return new Response(await readFile(path), { status: 200 }); }
    catch { return new Response('', { status: 404 }); }
  }
  // This evaluator never reads production services or user conversations.
  if (semantic === 'native' && String(url).startsWith('http://127.0.0.1:18082/')) return originalFetch(url, options);
  throw new Error(`Unexpected evaluation fetch: ${url}`);
};
const common = `
 export { prepareAliceTurn } from './packages/alice-ai/src/turn-engine.ts';
 export { createAliceMemory } from './packages/alice-ai/src/alice-memory-core.ts';
 export { createPedagogicalProfile } from './packages/alice-ai/src/pedagogical-profile-core.ts';
 export { loadRagCorpus, buildRagTurnContext } from './packages/alice-ai/src/rag.ts';
 export { getAllChunks } from './packages/alice-ai/src/knowledge-packs.ts';
 export { rankBySimilarity, toQueryText } from './packages/alice-ai/src/semantic-search.ts';
 ${learnRoot ? "export { registerLearnTurnContext } from './apps/app-web/src/lib/learn/turn-context.ts';" : ''}
`;
const oldBudget = `
 import { isDefinitionQuestion } from './packages/alice-ai/src/pedagogical-profile-core.ts';
 import { isTechnicalRagQuery } from './packages/alice-ai/src/rag.ts';
 import { ragContextChunkLimit } from './packages/alice-ai/src/rag-context-budget.ts';
 export function productionBudget(query, isLocal) {
   if (isDefinitionQuestion(query)) return 1;
   return ragContextChunkLimit(isLocal, isTechnicalRagQuery(query));
 }
`;
// c84fc611 and later share production policy. Historical 9c4a586a needs
// --baseline-budget legacy to reproduce its definition-first budget.
const sharedBudget = `
 import { ragQueryChunkBudget } from './packages/alice-ai/src/rag-query-policy.ts';
 import { isTechnicalRagQuery } from './packages/alice-ai/src/rag.ts';
 export function productionBudget(query, isLocal) {
   return ragQueryChunkBudget(query, isLocal, () => isTechnicalRagQuery(query));
 }
`;
const baselineBudget = value('--baseline-budget', 'shared');
assert.ok(['shared', 'legacy'].includes(baselineBudget));
const baseline = candidateOnly ? null : await loadRagEvaluationRuntime(common + (baselineBudget === 'legacy' ? oldBudget : sharedBudget), { revision: baselineRef });
const candidate = await loadRagEvaluationRuntime(common + sharedBudget + `\n export { knowledgeContextCharLimit } from './packages/alice-ai/src/knowledge-context-budget.ts';`);
await baseline?.loadRagCorpus();
await candidate.loadRagCorpus();
const corpusHash = chunks => createHash('sha256').update(chunks.map(c => `${c.id}\n${c.sourceHash ?? ''}\n${c.title}\n${c.content}`).join('\n\n')).digest('hex');
if (baseline) assert.equal(corpusHash(baseline.getAllChunks()), corpusHash(candidate.getAllChunks()), 'This comparison must keep the corpus fixed');
const knownConcepts = new Set(candidate.getAllChunks().map(chunk => chunk.conceptId ?? chunk.id));
assert.equal(new Set(fixture.cases.map(row => row.id)).size, fixture.cases.length, 'Duplicate case IDs');
for (const row of fixture.cases) {
  assert.ok(['fr', 'en'].includes(row.language));
  assert.ok(typeof row.question === 'string' && row.question.trim());
  assert.ok(Array.isArray(row.history) && Array.isArray(row.relevantConceptGroups));
  for (const group of row.relevantConceptGroups) {
    assert.ok(group.length > 0, `Empty information need: ${row.id}`);
    for (const id of group) assert.ok(knownConcepts.has(id), `Unknown gold concept: ${row.id}/${id}`);
  }
}
if (learnRoot) { baseline?.registerLearnTurnContext(); candidate.registerLearnTurnContext(); }

let extractor;
let modelLoadMs = null;
let index;
let semanticIndexProvenance = null;
const vectorCache = new Map();
const embeddingMs = [];
const semanticErrors = [];
if (semantic !== 'off') {
  const directory = semanticIndexDir ?? (semantic === 'web' ? 'apps/app-web/public/core-embeddings' : 'apps/wallet-mobile/assets/core-embeddings');
  const metadataBytes = await readFile(`${directory}/index.json`);
  const metadata = JSON.parse(metadataBytes);
  assert.ok(typeof metadata.model === 'string' && metadata.dim === 384);
  assert.deepEqual(metadata.ids, candidate.getAllChunks().map(chunk => chunk.id), 'Semantic index row order differs from the active corpus');
  const bytes = await readFile(`${directory}/embeddings.f32`);
  semanticIndexProvenance = { directory, model: metadata.model, metadataSha256: createHash('sha256').update(metadataBytes).digest('hex'), vectorsSha256: createHash('sha256').update(bytes).digest('hex') };
  assert.equal(bytes.length, metadata.ids.length * metadata.dim * 4, 'Invalid semantic matrix byte length');
  index = { ...metadata, vectors: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
  assert.equal(metadata.corpusHash, corpusHash(candidate.getAllChunks()));
  if (semantic === 'web') {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;
    const cache = value('--model-cache', null);
    if (cache) env.cacheDir = cache;
    const loadStarted = performance.now();
    extractor = await pipeline('feature-extraction', metadata.model, { local_files_only: true });
    modelLoadMs = performance.now() - loadStarted;
  }
  const match = async (query, topK) => {
    if (profiling || !vectorCache.has(query)) {
      const start = performance.now();
      let vector;
      if (semantic === 'web') {
        const output = await extractor([candidate.toQueryText(query)], { pooling: 'mean', normalize: true });
        vector = Float32Array.from(output.data.slice(0, index.dim));
      } else {
        const response = await fetch('http://127.0.0.1:18082/v1/embeddings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: [candidate.toQueryText(query)], model: index.model }),
        });
        assert.ok(response.ok, `Native embedding HTTP ${response.status}`);
        const json = await response.json();
        vector = Float32Array.from(json.data[0].embedding);
        const norm = Math.hypot(...vector);
        vector = vector.map(x => x / norm);
      }
      assert.equal(vector.length, index.dim);
      embeddingMs.push(performance.now() - start);
      vectorCache.set(query, vector);
    }
    return candidate.rankBySimilarity(vectorCache.get(query), index, topK);
  };
  // Production may fall back to lexical retrieval on an embedding failure.
  // An evaluator explicitly claiming E5 must instead fail the run.
  const checkedMatch = async (query, topK) => {
    try { return await match(query, topK); }
    catch (error) { semanticErrors.push(String(error)); throw error; }
  };
  baseline?.setEvaluationSemanticMatcher(checkedMatch);
  candidate.setEvaluationSemanticMatcher(checkedMatch);
}

const rows = [];
for (const [variant, runtime] of (profiling || candidateOnly ? [['candidate', candidate]] : [['baseline', baseline], ['candidate', candidate]])) {
  for (let repetition = 0; repetition < Math.max(1, profileRepeats); repetition++)
  for (const backend of ['local', 'cloud']) for (const row of fixture.cases) {
    let query = null, budget = 0, context = null, budgetMs = 0;
    packReads = [];
    const prepared = await runtime.prepareAliceTurn({
      history: [...row.history, { role: 'user', content: row.question }],
      userMessage: row.question, backendType: backend, targetLanguage: row.language,
    }, {
      recordPedagogicalSignal: async () => runtime.createPedagogicalProfile(),
      getMemory: async () => runtime.createAliceMemory(),
      rememberMemoryCandidates: async () => ({ memory: runtime.createAliceMemory(), saved: true }),
      pedagogicalContext: () => '', memoryContext: () => '', memoryCaptureInstruction: '',
      retrieveKnowledge: async q => {
        query = q;
        const budgetStarted = performance.now();
        budget = runtime.productionBudget(q, backend === 'local');
        budgetMs = performance.now() - budgetStarted;
        const maxContextChars = runtime.knowledgeContextCharLimit?.(backend === 'local');
        context = await runtime.buildRagTurnContext(q, undefined, { maxChunks: budget, targetLanguage: row.language, maxContextChars });
        if (maxContextChars !== undefined) assert.ok((context.ragContext?.length ?? 0) + (context.learnContext?.length ?? 0) <= maxContextChars);
        return context;
      },
    });
    assert.equal(prepared.history.at(-1).content, row.question);
    const ranked = [...new Set((context?.diagnostics ?? []).map(c => c.conceptId ?? c.id))];
    assert.ok(ranked.length <= budget);
    const groups = row.relevantConceptGroups;
    const ranks = groups.map(group => ranked.findIndex(id => group.includes(id)) + 1).filter(rank => rank > 0);
    rows.push({ variant, backend, repetition,
      ...(profiling ? { timingMs: { budget: budgetMs, ...prepared.diagnostics.phaseMs }, ragTimingMs: context?.timingMs ?? null } : {}),
      id: row.id, category: row.category, language: row.language,
      query, budget, ranked, recall: groups.length ? ranks.length / groups.length : null,
      mrr: groups.length ? (ranks.length ? 1 / Math.min(...ranks) : 0) : null,
      correctlySkipped: groups.length ? null : query === null,
      knowledgeChars: (context?.ragContext?.length ?? 0) + (context?.learnContext?.length ?? 0),
      learnChars: context?.learnContext?.length ?? 0, learnSource: context?.learnContext?.split('\n')[0] ?? null,
      packReads: [...packReads], contextChars: prepared.history.filter(m => m.role === 'system').reduce((n,m) => n + m.content.length, 0),
    });
  }
}
await extractor?.dispose();
assert.deepEqual(semanticErrors, [], 'E5 evaluation failed; lexical fallback is not a semantic result');
if (semantic !== 'off' && rows.some(row => row.query !== null)) {
  assert.ok(embeddingMs.length > 0, 'E5 evaluation did not compute any embeddings');
}

const summary = [];
for (const backend of ['local', 'cloud']) for (const variant of ['baseline', 'candidate']) {
 const subset = rows.filter(r => r.backend === backend && r.variant === variant);
 if (!subset.length) continue;
 const positive = subset.filter(r => r.recall !== null);
 const average = key => positive.reduce((n,r) => n + r[key], 0) / positive.length;
 summary.push({backend,variant,cases:subset.length,knowledgeCases:positive.length,recall:average('recall'),mrr:average('mrr'),
  negativeControlsPassed:subset.filter(r=>r.correctlySkipped === true).length,
  relationRecall:positive.some(r=>r.category==='relation') ? positive.filter(r=>r.category==='relation').reduce((n,r)=>n+r.recall,0)/positive.filter(r=>r.category==='relation').length : null,
  withLearn:subset.filter(r=>r.learnChars>0).length});
}
const regressions = candidateOnly ? null : profiling ? [] : rows.filter(r => r.variant === 'candidate').filter(r => {
 const old = rows.find(x=>x.variant==='baseline'&&x.backend===r.backend&&x.id===r.id);
 return (r.recall??0)<(old.recall??0)||(r.mrr??0)<(old.mrr??0)||(old.correctlySkipped===true&&r.correctlySkipped===false);
}).map(r=>({backend:r.backend,id:r.id}));
const percentile = (values, p) => values.sort((a,b)=>a-b)[Math.max(0, Math.ceil(values.length*p)-1)] ?? null;
const latency = profiling ? ['local', 'cloud'].map(backend => {
 const subset = rows.filter(r=>r.backend===backend && r.query !== null);
 const metrics = {};
 for (const [field, keys] of [['timingMs', ['budget','plan','rewrite','compose','pedagogy','retrieval','memory','total']], ['ragTimingMs', ['corpus','lexical','semantic','fusion','learn','localSummary','total']]]) {
  for (const key of keys) {
   const values = subset.map(r=>r[field]?.[key]).filter(Number.isFinite);
   metrics[`${field}.${key}`] = { n: values.length, p50: percentile([...values],.5), p95: percentile([...values],.95), max: Math.max(...values) };
  }
 }
 return {backend, metrics};
}) : null;
const report = { semanticIndexDir, semanticIndexProvenance, methodology:(candidateOnly ? 'Standalone candidate evaluation with its matching corpus/index; no within-run historical comparison. ' : '') + 'Frozen fixture; complete historical implementation vs working tree when comparisonPerformed is true; actual production chunk budgets; real prepareAliceTurn/buildRagTurnContext/composeGenerationHistory. E5 when enabled runs locally on Mac against the recorded index (shipped by default, experimental when overridden). Both source variants use the same chosen index; comparisons between model/index versions require separate reports. Learn when enabled reads existing pinned packs from disk. No LLM generation, browser WASM, Android hardware or network timing is claimed. Quality mode shares evaluator-only query vectors. Profiling recomputes every embedding, measures candidate preparation after corpus preload, includes first and repeated turns with pack caching, and stubs memory/pedagogy persistence. Parallel timings are not additive.',
 fixturePath, goldReviewPath, goldReviewSha256, baselineBudget, profiling, profileRepeats, modelLoadMs, latency,
 baselineRef: candidateOnly ? null : baselineRef,candidateOnly,comparisonPerformed: !candidateOnly && !profiling,semantic,learnEnabled:!!learnRoot,fixtureSha256:createHash('sha256').update(fixtureBytes).digest('hex'),corpusSha256:corpusHash(candidate.getAllChunks()),runtime:process.version,
 embeddingModel:index?.model??null,uniqueQueryEmbeddings:vectorCache.size,
 embeddingMs:embeddingMs.length?{min:Math.min(...embeddingMs),max:Math.max(...embeddingMs),mean:embeddingMs.reduce((a,b)=>a+b,0)/embeddingMs.length}:null,
 summary,regressions,rows};
globalThis.fetch = originalFetch;
if (args.includes('--output')) await writeFile(value('--output'), JSON.stringify(redactLocalPaths(report),null,2)+'\n');
console.log(JSON.stringify({...report,rows:undefined},null,2));
if (args.includes('--check')) {
 if (!candidateOnly) assert.deepEqual(regressions,[],'Per-case retrieval regressions');
 for (const row of summary.filter(r=>r.variant==='candidate')) {
  assert.equal(row.negativeControlsPassed, fixture.cases.filter(r=>r.relevantConceptGroups.length===0).length * Math.max(1, profileRepeats));
  if (fixturePath === 'scripts/data/rag-query-eval/questions.json') assert.equal(row.relationRecall,1,'Both information needs must survive the production budget');
 }
}
