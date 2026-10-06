import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Execute the actual native loader and registry; only platform I/O and the
// model are mocked. This catches compatibility failures hidden by RAG's
// evaluator-only semantic matcher.
// Reference tokenization for 'query: What is Bitcoin?' under the XLM-RoBERTa
// SPM vocabulary the candidate GGUF ships with (llama.rn tokenize, add_special=false).
const CORRECT_TOKENS = [41, 1294, 12, 4865, 83, 26999, 32];

let instance = 0;
async function nativeRuntime(
  change: (meta: any) => void = () => {},
  options: { tokens?: number[]; deferProbe?: boolean } = {},
) {
  const metadata = JSON.parse(await readFile('apps/wallet-mobile/assets/core-embeddings/index.json', 'utf8'));
  const bytes = await readFile('apps/wallet-mobile/assets/core-embeddings/embeddings.f32');
  const row = metadata.ids.indexOf('node-types');
  const matrix = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const queryVector = [...matrix.slice(row * metadata.dim, (row + 1) * metadata.dim)];
  change(metadata);
  const tokens = options.tokens ?? CORRECT_TOKENS;
  const mocks: Record<string, string> = {
    'react-native': `export const Platform = { OS: 'android' }; export const DeviceEventEmitter = { emit() {} };`,
    '@react-native-async-storage/async-storage': `export default { async getItem() { return 'auto'; }, async setItem() {} };`,
    'expo-network': `export const NetworkStateType = { WIFI: 'wifi' }; export async function getNetworkStateAsync() { return {type:'wifi',isInternetReachable:true}; } export function addNetworkStateListener() { return { remove() {} }; }`,
    'expo-file-system/legacy': `
      import { NATIVE_SEMANTIC_MODEL_DOWNLOAD_BYTES } from '${process.cwd()}/packages/alice-ai/src/semantic-policy.ts';
      export const documentDirectory = 'memory:/';
      export const EncodingType = { Base64: 'base64' };
      export async function makeDirectoryAsync() {}
      export async function deleteAsync() {}
      export async function copyAsync() {}
      export async function getInfoAsync(path) { return { exists: true, size: path.endsWith('.gguf') ? NATIVE_SEMANTIC_MODEL_DOWNLOAD_BYTES : ${bytes.length} }; }
      export async function readAsStringAsync(path) { return path.endsWith('.json') ? ${JSON.stringify(JSON.stringify(metadata))} : ${JSON.stringify(bytes.toString('base64'))}; }
    `,
    'llama.rn': `
      let resume;
      const probeGate = new Promise(resolve => { resume = resolve; });
      export const testCalls = { embedding: 0, release: 0, probing: false, resumeProbe() { resume(); } };
      export async function initLlama() { return {
      async tokenize() { testCalls.probing = true; if (${Boolean(options.deferProbe)}) await probeGate; return {tokens:${JSON.stringify(tokens)}}; },
      async embedding() { testCalls.embedding++; return {embedding:${JSON.stringify(queryVector)}}; },
      async release() { testCalls.release++; },
    }; }`,
  };
  const result = await build({
    stdin: { contents: `export * from './packages/alice-ai/src/semantic-runtime.native.ts'; export { registerPack } from './packages/alice-ai/src/knowledge-packs.ts'; export { testCalls } from 'llama.rn';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'native-test-io', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        // rag.ts need not load a second platform runtime during corpus registration.
        if (/\/semantic-runtime$/.test(args.path)) return { path: 'lexical-fallback', namespace: 'mock' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path] ?? 'export async function getSemanticMatches() { return null; }', loader: 'js', resolveDir: process.cwd() }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}#${instance++}`);
}

async function prepared(runtime: any) {
  runtime.preloadSemanticSearch();
  const deadline = Date.now() + 3000;
  while (['idle', 'loading'].includes(runtime.getSemanticSearchState().status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return runtime.getSemanticSearchState().status;
}

test('native preloading accepts the full shipped core and docs before any RAG turn', async () => {
  const runtime = await nativeRuntime();
  runtime.registerPack({ id: 'downloaded-test', source: 'downloaded', language: 'en', version: '1', chunks: [{id:'extra',title:'Extra',content:'Extra',keywords:[],level:'beginner'}] });
  runtime.registerPack({ id: 'optional-test', source: 'bundled', enabledByDefault: false, language: 'en', version: '1', chunks: [{id:'optional',title:'Optional',content:'Optional',keywords:[],level:'beginner'}] });
  try {
    assert.equal(await prepared(runtime), 'ready');
    assert.equal(runtime.isSemanticSearchReady(), true);
    const matches = await runtime.getSemanticMatches('node types', 2);
    assert.equal(matches?.[0]?.id, 'node-types');
  } finally { await runtime.releaseSemanticSearchContext(); }
});

test('native loading rejects stale content even when row IDs and vector sizes match', async () => {
  const runtime = await nativeRuntime(meta => { meta.corpusHash = '0'.repeat(64); });
  assert.equal(await prepared(runtime), 'failed');
  assert.equal(await runtime.getSemanticMatches('node types', 2), null);
});

test('native loading rejects reordered rows and invalid dimensions', async () => {
  for (const change of [
    (meta: any) => { [meta.ids[0], meta.ids[1]] = [meta.ids[1], meta.ids[0]]; },
    (meta: any) => { meta.dim = -1; },
  ]) {
    const runtime = await nativeRuntime(change);
    assert.equal(await prepared(runtime), 'failed');
  }
});

test('native loading rejects an outdated model id embedded in the index, regardless of row count', async () => {
  const runtime = await nativeRuntime(meta => { meta.model = 'keisuke-miyako/multilingual-e5-small-gguf-q8_0'; });
  assert.equal(await prepared(runtime), 'failed');
  assert.equal(await runtime.getSemanticMatches('node types', 2), null);
});

test('a context whose tokenizer does not match the reference probe is released and fails closed without embedding', async () => {
  // Wrong vocabulary (e.g. a BERT tokenizer loaded against this XLM-RoBERTa
  // GGUF) produces a different token sequence for the same probe string.
  const runtime = await nativeRuntime(() => {}, { tokens: [1, 2, 3] });
  try {
    assert.equal(await prepared(runtime), 'ready');
    const matches = await runtime.getSemanticMatches('node types', 2);
    assert.equal(matches, null);
    const calls = runtime.testCalls;
    assert.equal(runtime.getSemanticSearchState().status, 'failed');
    assert.equal(runtime.isSemanticSearchReady(), false);
    assert.equal(calls.embedding, 0);
    assert.equal(calls.release, 1);
  } finally { await runtime.releaseSemanticSearchContext(); }
});


test('disabling semantic search during a rejected probe keeps it off', async () => {
  const runtime = await nativeRuntime(() => {}, { tokens: [1, 2, 3], deferProbe: true });
  assert.equal(await prepared(runtime), 'ready');
  const query = runtime.getSemanticMatches('node types', 2);
  const deadline = Date.now() + 3000;
  while (!runtime.testCalls.probing && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(runtime.testCalls.probing, true);
  const disabling = runtime.disableSemanticSearch();
  runtime.testCalls.resumeProbe();
  assert.equal(await query, null);
  await disabling;
  assert.equal(runtime.getSemanticSearchState().status, 'off');
  assert.equal(runtime.isSemanticSearchReady(), false);
  assert.equal(runtime.testCalls.embedding, 0);
  assert.equal(runtime.testCalls.release, 1);
});
