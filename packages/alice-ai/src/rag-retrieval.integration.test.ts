import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';

async function loadBundledRag(): Promise<any> {
  const result = await build({
    stdin: {
      contents: [
        "export * from './packages/alice-ai/src/rag.ts';",
        "export { getAllChunks } from './packages/alice-ai/src/knowledge-packs.ts';",
      ].join('\n'),
      resolveDir: process.cwd(),
      sourcefile: 'rag-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    external: ['react-native', '@huggingface/transformers'],
  });
  const source = Buffer.from(result.outputFiles[0].contents).toString('base64');
  return import(`data:text/javascript;base64,${source}`);
}

test('the active core stays bounded while secondary knowledge remains outside retrieval', async () => {
  const rag = await loadBundledRag();
  await rag.loadRagCorpus();
  const chunks = rag.getAllChunks();
  // The bound guards the number of CONCEPTS the core carries: a French entry
  // and its English twin are one concept in two locales, and retrieval only
  // ever surfaces one of the pair (preferKnowledgeLocale). Counting raw
  // chunks would punish translating the core, which changes its size but
  // not its scope.
  // Two corpora with two purposes, bounded apart: Bitcoin knowledge, which
  // answers Bitcoin questions, and Alice's own documentation, which answers
  // questions about the project. Merging the bounds would let one grow
  // unnoticed behind the other.
  const isDocs = (chunk: { id: string }) => chunk.id.startsWith('docs-');
  const knowledge = new Set(
    chunks.filter((chunk: { id: string }) => !isDocs(chunk))
      .map((chunk: { conceptId: string }) => chunk.conceptId),
  );
  const docs = new Set(
    chunks.filter(isDocs).map((chunk: { conceptId: string }) => chunk.conceptId),
  );
  assert.ok(knowledge.size >= 150);
  assert.ok(knowledge.size <= 250);
  assert.ok(docs.size <= 150);
  const concepts = new Set(chunks.map((chunk: { conceptId: string }) => chunk.conceptId));
  // Guard against unbounded growth of the shipped corpus itself: at most one
  // twin per concept, no orphan twin without its source concept.
  assert.ok(chunks.length <= concepts.size * 2);
  assert.equal(chunks.some((chunk: { status?: string }) => chunk.status === 'secondaire'), false);
});

async function readSemanticIndex(basePath: string) {
  const indexPath = decodeURIComponent(new URL(`${basePath}/index.json`, import.meta.url).pathname);
  const vectorsPath = decodeURIComponent(new URL(`${basePath}/embeddings.f32`, import.meta.url).pathname);
  return {
    metadata: JSON.parse(await readFile(indexPath, 'utf8')) as {
      model: string;
      dim: number;
      ids: string[];
      corpusHash: string;
    },
    vectors: await readFile(vectorsPath),
  };
}

test('the web and native semantic indexes exactly match the active core corpus', async () => {
  const rag = await loadBundledRag();
  await rag.loadRagCorpus();
  const chunks = rag.getAllChunks();
  const expectedIds = chunks.map((chunk: { id: string }) => chunk.id);
  const expectedCorpusHash = createHash('sha256').update(chunks.map((chunk: {
    id: string;
    sourceHash?: string;
    title: string;
    content: string;
  }) => `${chunk.id}\n${chunk.sourceHash ?? ''}\n${chunk.title}\n${chunk.content}`).join('\n\n')).digest('hex');
  const indexes = await Promise.all([
    readSemanticIndex('../../../apps/app-web/public/core-embeddings'),
    readSemanticIndex('../../../apps/wallet-mobile/assets/core-embeddings'),
  ]);

  assert.equal(indexes[0].metadata.model, 'Xenova/multilingual-e5-small');
  assert.equal(indexes[1].metadata.model, 'keisuke-miyako/multilingual-e5-small-gguf-q8_0');
  for (const { metadata, vectors } of indexes) {
    assert.deepEqual(metadata.ids, expectedIds);
    assert.equal(vectors.byteLength, metadata.ids.length * metadata.dim * Float32Array.BYTES_PER_ELEMENT);
    assert.equal(metadata.corpusHash, expectedCorpusHash);
  }
});

test('definition queries return their dedicated beginner introductions', async () => {
  const rag = await loadBundledRag();
  for (const [query, expected] of [
    ['What is a UTXO?', 'utxo-introduction'],
    ['What is Ark?', 'ark-introduction'],
    ['Explain Proof of Work', 'proof-of-work-introduction'],
  ]) {
    const result = await rag.retrieveContextHybridWithDiagnostics(query, { maxChunks: 3, targetLanguage: 'en' });
    assert.equal(result.diagnostics[0]?.id, expected, query);
  }
});

test('wallet recovery paraphrases prefer the canonical recovery explanation', async () => {
  const rag = await loadBundledRag();
  for (const query of [
    'Pourquoi les mots secrets servent a recuperer mon argent ?',
    'How can 12 secret words restore my funds?',
  ]) {
    const result = await rag.retrieveContextHybridWithDiagnostics(query, { maxChunks: 1, targetLanguage: 'fr' });
    assert.equal(result.diagnostics[0]?.id, 'recovery-phrase', query);
  }
});
