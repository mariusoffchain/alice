// Precomputes one embedding vector per knowledge chunk (the bundled 'core'
// pack) using the same multilingual model the client will use for queries,
// so query and passage vectors live in the same space. Run this after
// build-obsidian-rag.js whenever the corpus changes.
//
// Output: apps/app-web/public/core-embeddings/index.json (chunk ids, dim,
// model id) + embeddings.f32 (row-major Float32Array, L2-normalized rows).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { build } = require('esbuild');

const BATCH_SIZE = 32;
const TARGET = process.env.ALICE_EMBEDDING_TARGET ?? 'web';
const TARGETS = {
  web: {
    modelId: 'Xenova/multilingual-e5-small',
    outputDir: path.join(__dirname, '..', 'apps', 'app-web', 'public', 'core-embeddings'),
  },
  native: {
    endpoint: process.env.ALICE_EMBEDDING_ENDPOINT ?? 'http://127.0.0.1:18082/v1/embeddings',
    modelId: 'keisuke-miyako/multilingual-e5-small-gguf-q8_0',
    outputDir: path.join(__dirname, '..', 'apps', 'wallet-mobile', 'assets', 'core-embeddings'),
  },
};

function normalize(values) {
  const vector = Float32Array.from(values);
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  for (let index = 0; index < vector.length; index += 1) vector[index] /= magnitude;
  return vector;
}

async function createEmbedder(target) {
  if (TARGET === 'web') {
    const { pipeline } = await import('@huggingface/transformers');
    const extractor = await pipeline('feature-extraction', target.modelId);
    return async texts => {
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      const dim = output.dims[1];
      return Array.from({ length: texts.length }, (_, row) => (
        Float32Array.from(output.data.slice(row * dim, (row + 1) * dim))
      ));
    };
  }

  return async texts => {
    const response = await fetch(target.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts, model: target.modelId }),
    });
    if (!response.ok) {
      throw new Error(`Native embedding server returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const rows = [...(payload.data ?? [])].sort((left, right) => left.index - right.index);
    if (rows.length !== texts.length || rows.some(row => !Array.isArray(row.embedding))) {
      throw new Error('Native embedding server returned an invalid matrix.');
    }
    return rows.map(row => normalize(row.embedding));
  };
}

async function main() {
  const target = TARGETS[TARGET];
  if (!target) throw new Error(`Unknown embedding target: ${TARGET}. Expected web or native.`);
  // Bundle the TypeScript entry explicitly. Direct TS imports depend on Node's
  // evolving ESM extension rules and previously made this release tool fail on
  // a clean machine even though application builds were valid.
  const bundled = await build({
    stdin: {
      contents: [
        "import './packages/alice-ai/src/rag.ts';",
        "export { getAllChunks } from './packages/alice-ai/src/knowledge-packs.ts';",
      ].join('\n'),
      resolveDir: path.join(__dirname, '..'),
      sourcefile: 'embedding-corpus-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    external: ['react-native', '@huggingface/transformers'],
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
  const { getAllChunks } = await import(moduleUrl);

  const chunks = getAllChunks();
  console.log(`Embedding ${chunks.length} chunks for ${TARGET} with ${target.modelId}...`);
  const embed = await createEmbedder(target);

  const ids = [];
  const vectors = [];
  let dim = null;

  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const batch = chunks.slice(start, start + BATCH_SIZE);
    const texts = batch.map(chunk => `passage: ${chunk.title}. ${chunk.content}`);
    const output = await embed(texts);
    dim = dim ?? output[0]?.length;
    if (!dim || output.some(vector => vector.length !== dim)) {
      throw new Error('Embedding dimensions are inconsistent.');
    }
    for (let row = 0; row < batch.length; row += 1) {
      ids.push(batch[row].id);
      vectors.push(output[row]);
    }
    process.stdout.write(`\r  ${Math.min(start + BATCH_SIZE, chunks.length)}/${chunks.length}`);
  }
  process.stdout.write('\n');

  const matrix = new Float32Array(ids.length * dim);
  vectors.forEach((vector, row) => matrix.set(vector, row * dim));

  fs.mkdirSync(target.outputDir, { recursive: true });
  fs.writeFileSync(path.join(target.outputDir, 'embeddings.f32'), Buffer.from(matrix.buffer));
  fs.writeFileSync(
    path.join(target.outputDir, 'index.json'),
    JSON.stringify({
      model: target.modelId,
      dim,
      ids,
      corpusHash: crypto.createHash('sha256').update(chunks.map(chunk => (
        `${chunk.id}\n${chunk.sourceHash ?? ''}\n${chunk.title}\n${chunk.content}`
      )).join('\n\n')).digest('hex'),
    }, null, 2),
  );

  console.log(`Wrote ${ids.length} vectors (dim=${dim}) to ${target.outputDir}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
