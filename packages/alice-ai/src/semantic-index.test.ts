import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadRagEvaluationRuntime } from '../../../scripts/rag-eval-runtime.mjs';

const runtime = await loadRagEvaluationRuntime(`
  export { loadRagCorpus } from './packages/alice-ai/src/rag.ts';
  export { getBundledKnowledgeChunks, registerPack, unregisterPack } from './packages/alice-ai/src/knowledge-packs.ts';
  export { validateSemanticIndexMetadata } from './packages/alice-ai/src/semantic-index.ts';
`);
await runtime.loadRagCorpus();

test('both shipped indexes satisfy the full corpus contract', async () => {
  const chunks = runtime.getBundledKnowledgeChunks();
  assert.ok(chunks.some((chunk: {id: string}) => chunk.id.startsWith('docs-')));
  for (const path of ['apps/app-web/public', 'apps/wallet-mobile/assets']) {
    const metadata = JSON.parse(await readFile(`${path}/core-embeddings/index.json`, 'utf8'));
    assert.equal(runtime.validateSemanticIndexMetadata(metadata, metadata.model, chunks), metadata);
    assert.equal(runtime.validateSemanticIndexMetadata(metadata, 'another-model', chunks), null);
    assert.equal(runtime.validateSemanticIndexMetadata(metadata, metadata.model,
      chunks.map((chunk: object, index: number) => index === 0 ? { ...chunk, content: 'Changed without changing the ID.' } : chunk)), null);
  }
});

test('invalid semantic metadata cannot be accepted through type assertions', () => {
  const chunks = runtime.getBundledKnowledgeChunks();
  for (const metadata of [null, {}, {model:'e5',dim:384,ids:null}, {model:'e5',dim:0,ids:[]}, {model:'e5',dim:384,ids:chunks.map(() => chunks[0].id)}]) {
    assert.equal(runtime.validateSemanticIndexMetadata(metadata, 'e5', chunks), null);
  }
});

test('a bundled pack registered at runtime never changes the corpus the index is validated against', async () => {
  const before = runtime.getBundledKnowledgeChunks();
  const metadata = JSON.parse(await readFile('apps/app-web/public/core-embeddings/index.json', 'utf8'));
  // The Explorer page registers such a pack on the web; it is retrieved lexically only.
  runtime.registerPack({
    id: 'test-runtime-pack', version: '1', language: 'multi', source: 'bundled', enabledByDefault: true,
    chunks: [{ ...before[0], id: 'test-runtime-chunk', content: 'Registered at runtime, outside the shipped index.' }],
  });
  try {
    assert.equal(runtime.getBundledKnowledgeChunks().length, before.length);
    assert.equal(runtime.validateSemanticIndexMetadata(metadata, metadata.model, runtime.getBundledKnowledgeChunks()), metadata);
  } finally {
    runtime.unregisterPack('test-runtime-pack');
  }
});
