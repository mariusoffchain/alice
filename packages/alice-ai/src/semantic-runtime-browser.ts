// Browser-side loader for the semantic search layer: downloads the
// multilingual embedding model (cached by the browser afterwards) and the
// precomputed chunk-embedding index, then answers "which chunk ids are
// semantically closest to this query". Everything here fails open, if the
// model or index is not ready yet (or fails to load at all), callers get
// `null` and fall back to the always-available lexical scorer in rag.ts.
// This is a relevance nicety, not a security boundary, so failing open is
// the right default (unlike the E2EE fail-closed rule elsewhere).
//
// The download starts on the FIRST QUESTION, not at app launch: ~150 MB is
// too much to spend on a visitor who never asks anything. It is also never
// started on its own when the browser signals a data-saving connection, and
// the user can remove the cached model or switch the feature off in Settings
// (see semantic-policy.ts for the rules, getSemanticSearchState for the
// surface). A question asked while loading is answered lexically right away
// instead of waiting behind the download.
import type { ChunkEmbeddingIndex, SemanticMatch } from './semantic-search';
import { rankBySimilarity, toQueryText } from './semantic-search';
import {
  SEMANTIC_SEARCH_PREFERENCE_KEY,
  SEMANTIC_SEARCH_STATE_EVENT,
  canAutoStartSemanticDownload,
  parseSemanticSearchPreference,
  type SemanticSearchPreference,
  type SemanticSearchState,
} from './semantic-policy';

const MODEL_ID = 'Xenova/multilingual-e5-small';
// Where @huggingface/transformers caches its downloads (Cache API).
const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: true },
) => Promise<{ dims: number[]; data: Float32Array }>;

let pipelinePromise: Promise<FeatureExtractionPipeline | null> | null = null;
let indexPromise: Promise<ChunkEmbeddingIndex | null> | null = null;
let state: SemanticSearchState = { status: 'idle', progress: null };
// One generation per enable/disable cycle: a disable during a download makes
// the in-flight results land in a stale generation and get dropped.
let generation = 0;

function setState(next: SemanticSearchState): void {
  state = next;
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(SEMANTIC_SEARCH_STATE_EVENT));
    } catch {
      // Event delivery is a UI nicety.
    }
  }
}

function readPreference(): SemanticSearchPreference {
  try {
    return parseSemanticSearchPreference(
      typeof window === 'undefined'
        ? undefined
        : window.localStorage.getItem(SEMANTIC_SEARCH_PREFERENCE_KEY),
    );
  } catch {
    return 'auto';
  }
}

function writePreference(preference: SemanticSearchPreference): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SEMANTIC_SEARCH_PREFERENCE_KEY, preference);
    }
  } catch {
    // Best-effort, same policy as the rest of the app.
  }
}

function connectionAsksForDataSaving(): boolean {
  try {
    const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
    return connection?.saveData === true;
  } catch {
    return false;
  }
}

// True only inside an INSTALLED desktop build (origin tauri://localhost),
// where build-web.sh bundled the model and the ONNX runtime under
// /semantic-model/. `tauri dev` serves plain http and stays on the hub path,
// like the web.
function isEmbeddedDesktopBuild(): boolean {
  return typeof window !== 'undefined' && window.location.protocol.startsWith('tauri');
}

async function loadPipeline(): Promise<FeatureExtractionPipeline | null> {
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    if (isEmbeddedDesktopBuild()) {
      // Fully self-contained: model files and WASM runtime from the app
      // bundle, no Hugging Face, no jsDelivr. Remote stays allowed as a
      // per-file fallback so a partial bundle degrades instead of breaking.
      env.allowLocalModels = true;
      env.localModelPath = '/semantic-model/';
      if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = '/semantic-model/ort/';
    } else {
      // On the web there is nothing local to probe; skipping the probe also
      // silences the two 404s it printed on every model load.
      env.allowLocalModels = false;
    }
    // The hub serves the model as several files; progress is their combined
    // byte count so the settings bar moves once, monotonically.
    const perFile = new Map<string, { loaded: number; total: number }>();
    const onProgress = (event: {
      status?: string;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (event.status !== 'progress' || !event.file || !event.total) return;
      perFile.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
      let loaded = 0;
      let total = 0;
      for (const entry of perFile.values()) {
        loaded += entry.loaded;
        total += entry.total;
      }
      if (state.status === 'loading' && total > 0) {
        setState({ status: 'loading', progress: Math.min(loaded / total, 1) });
      }
    };
    return (await pipeline('feature-extraction', MODEL_ID, {
      progress_callback: onProgress,
    })) as unknown as FeatureExtractionPipeline;
  } catch {
    return null;
  }
}

async function loadIndex(baseUrl: string): Promise<ChunkEmbeddingIndex | null> {
  try {
    const [indexResponse, vectorsResponse] = await Promise.all([
      fetch(`${baseUrl}/index.json`),
      fetch(`${baseUrl}/embeddings.f32`),
    ]);
    if (!indexResponse.ok || !vectorsResponse.ok) return null;

    const meta = await indexResponse.json() as { model: string; dim: number; ids: string[] };
    if (meta.model !== MODEL_ID) return null;
    const buffer = await vectorsResponse.arrayBuffer();
    const vectors = new Float32Array(buffer);
    if (vectors.length !== meta.ids.length * meta.dim) return null;

    return { dim: meta.dim, ids: meta.ids, vectors };
  } catch {
    return null;
  }
}

function startLoading(baseUrl: string): void {
  const startedGeneration = generation;
  setState({ status: 'loading', progress: null });
  pipelinePromise = loadPipeline();
  indexPromise = loadIndex(baseUrl);
  void Promise.all([pipelinePromise, indexPromise]).then(([extractor, index]) => {
    if (startedGeneration !== generation) return;
    setState(
      extractor && index
        ? { status: 'ready', progress: null }
        : { status: 'failed', progress: null },
    );
  });
}

/**
 * Starts loading the model and the embedding index, subject to policy: an
 * automatic call (first question) is refused when the user switched the
 * feature off or the connection asks for data saving; a `force` call (the
 * Settings download button) is refused nothing.
 */
export function preloadSemanticSearch(baseUrl = '/core-embeddings', force = false): void {
  if (state.status === 'loading' || state.status === 'ready') return;
  if (!force) {
    const preference = readPreference();
    if (!canAutoStartSemanticDownload(preference, connectionAsksForDataSaving())) {
      setState({
        status: preference === 'off' ? 'off' : 'blocked-metered',
        progress: null,
      });
      return;
    }
  }
  startLoading(baseUrl);
}

export function isSemanticSearchReady(): boolean {
  return state.status === 'ready';
}

/** Current state for the Settings surface; changes fire SEMANTIC_SEARCH_STATE_EVENT. */
export function getSemanticSearchState(): SemanticSearchState {
  return state;
}

/** Settings action: the user explicitly asked for the model, policy aside. */
export function downloadSemanticSearchNow(): void {
  writePreference('auto');
  if (state.status === 'failed') {
    // A retry must actually retry, not reuse the failed promises.
    pipelinePromise = null;
    indexPromise = null;
    setState({ status: 'idle', progress: null });
  }
  preloadSemanticSearch(undefined, true);
}

/**
 * Settings action: stop using semantic search and remove the cached model.
 * The preference persists, so a later question will not silently re-download;
 * only the Settings enable button comes back from this.
 */
export async function disableSemanticSearch(): Promise<void> {
  writePreference('off');
  generation += 1;
  pipelinePromise = null;
  indexPromise = null;
  setState({ status: 'off', progress: null });
  try {
    await caches.delete(TRANSFORMERS_CACHE_NAME);
  } catch {
    // No Cache API, nothing cached.
  }
}

export async function releaseSemanticSearchContext(): Promise<void> {}

export async function getSemanticMatches(query: string, topK: number): Promise<SemanticMatch[] | null> {
  // The first question is the download trigger, and it is answered lexically
  // right away rather than waiting behind a 150 MB fetch.
  if (state.status !== 'ready') {
    if (state.status === 'idle') preloadSemanticSearch();
    return null;
  }
  if (!pipelinePromise || !indexPromise) return null;
  const [extractor, index] = await Promise.all([pipelinePromise, indexPromise]);
  if (!extractor || !index) return null;

  try {
    const output = await extractor([toQueryText(query)], { pooling: 'mean', normalize: true });
    const queryVector = output.data.slice(0, index.dim);
    return rankBySimilarity(queryVector, index, topK);
  } catch {
    return null;
  }
}
