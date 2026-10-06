#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { loadRagEvaluationRuntime } from './rag-eval-runtime.mjs';

const fixturePath = new URL('./data/rag-query-eval/questions.json', import.meta.url);
const fixtureBytes = await readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes);
const runtime = await loadRagEvaluationRuntime(`
  export { retrieveContextHybridWithDiagnostics, loadRagCorpus } from './packages/alice-ai/src/rag.ts';
  export { getAllChunks } from './packages/alice-ai/src/knowledge-packs.ts';
  export { prepareAliceTurn } from './packages/alice-ai/src/turn-engine.ts';
  export { createAliceMemory } from './packages/alice-ai/src/alice-memory-core.ts';
  export { createPedagogicalProfile } from './packages/alice-ai/src/pedagogical-profile-core.ts';
  export { planAliceTurn as baselinePlan } from './scripts/data/rag-query-eval/baseline-planner.ts';
  export { baselineRetrievalQueryForTurn } from './scripts/data/rag-query-eval/baseline-rewrite.ts';
`);
await runtime.loadRagCorpus();
const chunks = runtime.getAllChunks();
const concepts = new Set(chunks.map(chunk => chunk.conceptId ?? chunk.id));
assert.equal(fixture.cases.length, 80);
assert.equal(new Set(fixture.cases.map(row => row.id)).size, fixture.cases.length);
for (const row of fixture.cases) {
  for (const group of row.relevantConceptGroups) {
    assert.ok(group.length > 0);
    for (const id of group) assert.ok(concepts.has(id), `Unknown concept ${id} in ${row.id}`);
  }
}

function score(row, query, diagnostics) {
  // Locale variants are one concept. Alternative chunks for an information
  // need count once; a comparison can require two different information needs.
  const ranked = [...new Set(diagnostics.map(chunk => chunk.conceptId ?? chunk.id))].slice(0, 3);
  const groups = row.relevantConceptGroups;
  const ranks = groups.map(group => ranked.findIndex(id => group.includes(id)) + 1);
  const relevantRanks = ranks.filter(rank => rank > 0);
  return {
    query, ranked,
    recallAt3: groups.length ? relevantRanks.length / groups.length : null,
    reciprocalRankAt3: groups.length ? (relevantRanks.length ? 1 / Math.min(...relevantRanks) : 0) : null,
    correctlySkipped: groups.length ? null : query === null,
  };
}
const rows = [];
for (const row of fixture.cases) {
  const history = [...row.history, { role: 'user', content: row.question }];
  const query = runtime.baselineRetrievalQueryForTurn(history, runtime.baselinePlan(row.question));
  const baselineResult = query ? await runtime.retrieveContextHybridWithDiagnostics(query, { maxChunks: 3, targetLanguage: row.language }) : { diagnostics: [] };
  let candidateQuery = null;
  let candidateDiagnostics = [];
  const prepared = await runtime.prepareAliceTurn({ history, userMessage: row.question, backendType: 'cloud', targetLanguage: row.language }, {
    recordPedagogicalSignal: async () => runtime.createPedagogicalProfile(),
    retrieveKnowledge: async q => {
      candidateQuery = q;
      const result = await runtime.retrieveContextHybridWithDiagnostics(q, { maxChunks: 3, targetLanguage: row.language });
      candidateDiagnostics = result.diagnostics;
      return { ragContext: result.context, localContext: null, learnContext: null, diagnostics: result.diagnostics };
    },
    getMemory: async () => runtime.createAliceMemory(),
    rememberMemoryCandidates: async () => ({ memory: runtime.createAliceMemory(), saved: true }),
    pedagogicalContext: () => '', memoryContext: () => '', memoryCaptureInstruction: '',
  });
  assert.equal(prepared.history.at(-1).content, row.question, `Raw question altered: ${row.id}`);
  rows.push({ id: row.id, category: row.category, language: row.language,
    baseline: score(row, query, baselineResult.diagnostics),
    candidate: score(row, candidateQuery, candidateDiagnostics),
  });
}
function metrics(subset, variant) {
  const positives = subset.filter(row => row[variant].recallAt3 !== null);
  const negatives = subset.filter(row => row[variant].correctlySkipped !== null);
  const average = key => positives.length ? positives.reduce((sum, row) => sum + row[variant][key], 0) / positives.length : null;
  return { cases: subset.length, retrievalCases: positives.length,
    recallAt3: average('recallAt3'), mrrAt3: average('reciprocalRankAt3'),
    noRetrievalCases: negatives.length, correctlySkipped: negatives.filter(row => row[variant].correctlySkipped).length,
  };
}
function compare(subset) { return { baseline: metrics(subset, 'baseline'), candidate: metrics(subset, 'candidate') }; }
const regression = row => (row.candidate.recallAt3 ?? 0) < (row.baseline.recallAt3 ?? 0)
  || (row.candidate.reciprocalRankAt3 ?? 0) < (row.baseline.reciprocalRankAt3 ?? 0)
  || (row.baseline.correctlySkipped === true && row.candidate.correctlySkipped === false);
const report = {
  methodology: 'Offline lexical retrieval through real prepareAliceTurn + active corpus, fixed maxChunks=3. Macro recall over required information-need groups; MRR truncated at rank 3. No-retrieval cases excluded from recall/MRR. Semantic model and Learn excerpts not measured; production local/definition budgets can be smaller.',
  baselineCommit: fixture.baselineCommit,
  datasetSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  corpusSha256: createHash('sha256').update(chunks.map(c => `${c.id}\n${c.sourceHash ?? ''}\n${c.title}\n${c.content}`).join('\n\n')).digest('hex'),
  runtime: process.version, chunks: chunks.length, concepts: concepts.size,
  overall: compare(rows),
  byCategory: Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => [category, compare(rows.filter(row => row.category === category))])),
  byLanguage: Object.fromEntries(['fr', 'en'].map(language => [language, compare(rows.filter(row => row.language === language))])),
  regressions: rows.filter(regression).map(row => row.id),
  changedQueries: rows.filter(row => row.baseline.query !== row.candidate.query).length,
  rows,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  assert.ok(process.argv[outputIndex + 1], '--output requires a file path');
  await writeFile(process.argv[outputIndex + 1], `${JSON.stringify(report, null, 2)}\n`);
}
const { rows: _rows, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
if (process.argv.includes('--check')) {
  const { baseline, candidate } = report.overall;
  assert.ok(candidate.recallAt3 > baseline.recallAt3, 'Recall@3 must improve');
  assert.ok(candidate.mrrAt3 >= baseline.mrrAt3, 'MRR@3 must not regress');
  assert.deepEqual(report.regressions, [], 'Individual reference cases must not regress');
  assert.equal(candidate.correctlySkipped, candidate.noRetrievalCases, 'Negative controls must bypass retrieval');
}
