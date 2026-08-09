// Native semantic RAG runtime. The compact E5 embedding model is downloaded
// only on Wi-Fi; until it is ready, rag.ts keeps using its lexical fallback.
import { Platform } from 'react-native';
import { getRegisteredPacks } from './knowledge-packs';
import type { ChunkEmbeddingIndex, SemanticMatch } from './semantic-search';
import { rankBySimilarity, toQueryText } from './semantic-search';

const EMBEDDING_MODEL = {
  id: 'keisuke-miyako/multilingual-e5-small-gguf-q8_0',
  filename: 'multilingual-e5-small-Q8_0.gguf',
  sizeBytes: 131_953_504,
  url: 'https://huggingface.co/keisuke-miyako/multilingual-e5-small-gguf-q8_0/resolve/main/multilingual-e5-small-Q8_0.gguf',
};
const LEGACY_MODEL_FILENAMES = ['multilingual-e5-small-q8_0.gguf'];
const BUNDLED_INDEX_DIR = 'core-embeddings';
const IDLE_RELEASE_MS = 30_000;

type EmbeddingContext = {
  embedding(text: string): Promise<{ embedding: number[] }>;
  release(): Promise<void>;
};

let indexPromise: Promise<ChunkEmbeddingIndex | null> | null = null;
let modelReadyPromise: Promise<boolean> | null = null;
let embeddingContextPromise: Promise<EmbeddingContext | null> | null = null;
let networkSubscription: { remove(): void } | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let indexReady = false;
let modelReady = false;
let didLogContextReady = false;
let didLogContextFailure = false;

function base64ToFloat32Array(value: string): Float32Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Float32Array(bytes.buffer);
}

function normalize(vector: number[]): Float32Array {
  const result = new Float32Array(vector);
  const magnitude = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return result;
  for (let index = 0; index < result.length; index += 1) result[index] /= magnitude;
  return result;
}

async function nativePaths() {
  const FileSystem = await import('expo-file-system/legacy');
  const directory = `${FileSystem.documentDirectory}semantic-search/`;
  return {
    FileSystem,
    directory,
    model: `${directory}${EMBEDDING_MODEL.filename}`,
    vectors: `${directory}embeddings.f32`,
  };
}

async function bundledCandidates(filename: string): Promise<string[]> {
  const { FileSystem } = await nativePaths();
  const candidates: string[] = [];
  if (Platform.OS === 'android') candidates.push(`asset:///${BUNDLED_INDEX_DIR}/${filename}`);
  if (FileSystem.bundleDirectory) candidates.push(`${FileSystem.bundleDirectory}${BUNDLED_INDEX_DIR}/${filename}`);
  return candidates;
}

async function copyBundledAsset(filename: string, destination: string): Promise<boolean> {
  const { FileSystem } = await nativePaths();
  for (const source of await bundledCandidates(filename)) {
    try {
      await FileSystem.copyAsync({ from: source, to: destination });
      return true;
    } catch {
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
    }
  }
  return false;
}

async function loadBundledIndex(): Promise<ChunkEmbeddingIndex | null> {
  try {
    const { FileSystem, directory, vectors } = await nativePaths();
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

    let metadataText: string | null = null;
    for (const source of await bundledCandidates('index.json')) {
      try {
        metadataText = await FileSystem.readAsStringAsync(source);
        break;
      } catch {
        // Try the next platform-specific bundle path.
      }
    }
    if (!metadataText) return null;

    const metadata = JSON.parse(metadataText) as {
      model?: string;
      dim: number;
      ids: string[];
      corpusHash?: string;
    };
    if (metadata.model !== EMBEDDING_MODEL.id) return null;
    const coreIds = getRegisteredPacks().find(pack => pack.id === 'core')?.chunks.map(chunk => chunk.id) ?? [];
    if (coreIds.length !== metadata.ids.length || coreIds.some((id, index) => metadata.ids[index] !== id)) {
      return null;
    }
    const expectedBytes = metadata.dim * metadata.ids.length * Float32Array.BYTES_PER_ELEMENT;
    // The corpus can change without changing the row count or vector size.
    // Refresh this small bundled matrix on every process start so an app
    // update can never combine new metadata with stale on-device vectors.
    await FileSystem.deleteAsync(vectors, { idempotent: true });
    if (!(await copyBundledAsset('embeddings.f32', vectors))) return null;
    const copied = await FileSystem.getInfoAsync(vectors);
    if (!copied.exists || copied.size !== expectedBytes) return null;

    const encodedVectors = await FileSystem.readAsStringAsync(vectors, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const vectorValues = base64ToFloat32Array(encodedVectors);
    if (vectorValues.length !== metadata.dim * metadata.ids.length) return null;
    return { dim: metadata.dim, ids: metadata.ids, vectors: vectorValues };
  } catch {
    return null;
  }
}

async function isWifiReachable(): Promise<boolean> {
  try {
    const Network = await import('expo-network');
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.WIFI && state.isInternetReachable !== false;
  } catch {
    return false;
  }
}

async function ensureEmbeddingModel(): Promise<boolean> {
  try {
    const { FileSystem, directory, model } = await nativePaths();
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await Promise.all(LEGACY_MODEL_FILENAMES.map(filename => (
      FileSystem.deleteAsync(`${directory}${filename}`, { idempotent: true }).catch(() => {})
    )));
    const current = await FileSystem.getInfoAsync(model);
    if (current.exists && current.size === EMBEDDING_MODEL.sizeBytes) return true;
    await FileSystem.deleteAsync(model, { idempotent: true });

    const partial = `${model}.download`;
    await FileSystem.deleteAsync(partial, { idempotent: true });
    const download = FileSystem.createDownloadResumable(EMBEDDING_MODEL.url, partial);
    const result = await download.downloadAsync();
    const downloaded = await FileSystem.getInfoAsync(partial);
    if (result?.status !== 200 || !downloaded.exists || downloaded.size !== EMBEDDING_MODEL.sizeBytes) {
      throw new Error('Semantic model download was incomplete.');
    }
    await FileSystem.moveAsync({ from: partial, to: model });
    return true;
  } catch {
    return false;
  }
}

function scheduleContextRelease(): void {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => {
    const active = embeddingContextPromise;
    embeddingContextPromise = null;
    active?.then(context => context?.release().catch(() => {}));
  }, IDLE_RELEASE_MS);
}

/** Releases the embedding model before a generative local model starts. */
export async function releaseSemanticSearchContext(): Promise<void> {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  const active = embeddingContextPromise;
  embeddingContextPromise = null;
  const context = await active;
  await context?.release().catch(() => {});
}

async function loadEmbeddingContext(): Promise<EmbeddingContext | null> {
  const { model } = await nativePaths();
  try {
    const llama = await import('llama.rn');
    const context = await llama.initLlama({
      model,
      n_ctx: 512,
      n_threads: 2,
      n_gpu_layers: 0,
      embedding: true,
      embd_normalize: 2,
    }) as EmbeddingContext;
    if (!didLogContextReady) {
      didLogContextReady = true;
      console.info('[alice-semantic] native embedding context ready');
    }
    return context;
  } catch (error) {
    if (!didLogContextFailure) {
      didLogContextFailure = true;
      console.warn('[alice-semantic] native embedding context unavailable', error);
    }
    return null;
  }
}

async function prepareWhenWifiIsAvailable(): Promise<void> {
  if (!(await isWifiReachable())) return;
  networkSubscription?.remove();
  networkSubscription = null;
  indexPromise ??= loadBundledIndex().then(index => {
    indexReady = Boolean(index);
    if (!index) indexPromise = null;
    return index;
  });
  modelReadyPromise ??= ensureEmbeddingModel().then(ready => {
    modelReady = ready;
    if (!ready) modelReadyPromise = null;
    return ready;
  });
}

function watchForWifi(): void {
  if (networkSubscription) return;
  void import('expo-network').then(Network => {
    networkSubscription ??= Network.addNetworkStateListener(() => {
      void prepareWhenWifiIsAvailable();
    });
  }).catch(() => {});
}

/** Starts the Wi-Fi-only semantic model download without blocking chat. */
export function preloadSemanticSearch(): void {
  void prepareWhenWifiIsAvailable();
  watchForWifi();
}

export function isSemanticSearchReady(): boolean {
  return indexReady && modelReady;
}

export async function getSemanticMatches(query: string, topK: number): Promise<SemanticMatch[] | null> {
  if (!indexPromise || !modelReadyPromise) {
    preloadSemanticSearch();
    return null;
  }
  const [index, modelReady] = await Promise.all([indexPromise, modelReadyPromise]);
  if (!index || !modelReady) return null;

  embeddingContextPromise ??= loadEmbeddingContext();
  const context = await embeddingContextPromise;
  if (!context) return null;

  try {
    const result = await context.embedding(toQueryText(query));
    const vector = normalize(result.embedding);
    if (vector.length !== index.dim) return null;
    return rankBySimilarity(vector, index, topK);
  } catch {
    return null;
  } finally {
    scheduleContextRelease();
  }
}
