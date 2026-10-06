import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRagEvaluationRuntime } from '../../../scripts/rag-eval-runtime.mjs';

const runtime = await loadRagEvaluationRuntime(`
  export { loadRagCorpus, retrieveContextHybridWithDiagnostics } from './packages/alice-ai/src/rag.ts';
  export { registerPack, unregisterPack } from './packages/alice-ai/src/knowledge-packs.ts';
`);
await runtime.loadRagCorpus();

async function ids(query: string, maxChunks = 2) {
  const result = await runtime.retrieveContextHybridWithDiagnostics(query, { maxChunks, targetLanguage: 'fr' });
  assert.ok(result.diagnostics.length <= maxChunks);
  return result.diagnostics.map((chunk: { id: string; conceptId?: string }) => chunk.conceptId ?? chunk.id);
}

test('technical comparisons retain detailed evidence instead of an unrelated beginner match', async () => {
  assert.ok((await ids("What's the difference between a full node and a pruned node?")).includes('node-types'));
  assert.ok((await ids('Pourquoi la plupart des mineurs rejoignent-ils des pools plutôt que de miner seuls ?')).includes('mining-pools'));
});

test('French technical phrases tolerate articles and ligatures without increasing the context budget', async () => {
  assert.equal((await ids('Pourquoi l’ajustement de la difficulté se fait toutes les deux semaines environ ?', 1))[0], 'difficulty-adjustment');
  const query = 'Quelle est la différence entre un nœud complet et un nœud élagué ?';
  assert.deepEqual(await ids(query), await ids(query.replaceAll('œ', 'oe')));
});

function registerSynthetic(chunks: object[]) {
  runtime.registerPack({ id: 'ranking-test', version: '1', language: 'fr', source: 'bundled', chunks });
}

const evidence = { id: 'ranking-evidence', title: 'Evidence', level: 'intermediate', keywords: ['quartz'], content: 'Quartz zephyr.' };
const decoy = { id: 'ranking-decoy', title: 'Decoy', level: 'intermediate', keywords: ['quartz', 'zephyr'], content: 'Unrelated text.' };

test('keyword metadata is not scored a second time as body evidence', async () => {
  registerSynthetic([decoy, evidence]);
  try { assert.equal((await ids('quartz zephyr', 1))[0], evidence.id); }
  finally { runtime.unregisterPack('ranking-test'); }
});

test('case and accent aliases cannot inflate a competing note’s keyword score', async () => {
  registerSynthetic([decoy, evidence]);
  try {
    const original = await ids('quartz zephyr');
    registerSynthetic([{ ...decoy, keywords: ['quartz', 'QUARTZ', 'quàrtz', 'zephyr', 'ZEPHYR', 'zéphyr'] }, evidence]);
    assert.deepEqual(await ids('quartz zephyr'), original);
  } finally { runtime.unregisterPack('ranking-test'); }
});

test('repeating a query term cannot crowd out a note covering both terms', async () => {
  registerSynthetic([evidence, { ...decoy, keywords: [], title: 'Zephyr', content: 'Unrelated text.' }]);
  try {
    assert.deepEqual(await ids('quartz zephyr zephyr zephyr zephyr'), await ids('quartz zephyr'));
  } finally { runtime.unregisterPack('ranking-test'); }
});
