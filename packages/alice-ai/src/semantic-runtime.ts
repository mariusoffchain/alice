// Browser-side loader for the semantic search layer: downloads the
// multilingual embedding model (cached by the browser afterwards) and the
// precomputed chunk-embedding index, then answers "which chunk ids are
// semantically closest to this query". Everything here fails open — if the
// model or index is not ready yet (or fails to load at all), callers get
// `null` and fall back to the always-available lexical scorer in rag.ts.
// This is a relevance nicety, not a security boundary, so failing open is
// the right default (unlike the E2EE fail-closed rule elsewhere).
import type { ChunkEmbeddingIndex, SemanticMatch } from './semantic-search';
import { rankBySimilarity, toQueryText } from './semantic-search';

const MODEL_ID = 'Xenova/multilingual-e5-small';

type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: true },
) => Promise<{ dims: number[]; data: Float32Array }>;

let pipelinePromise: Promise<FeatureExtractionPipeline | null> | null = null;
let indexPromise: Promise<ChunkEmbeddingIndex | null> | null = null;

async function loadPipeline(): Promise<FeatureExtractionPipeline | null> {
  try {
    const { pipeline } = await import('@huggingface/transformers');
    return (await pipeline('feature-extraction', MODEL_ID)) as unknown as FeatureExtractionPipeline;
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

/**
 * Starts loading the model and the embedding index in the background.
 * Safe to call multiple times (loads happen once); safe to never await —
 * callers just get `null` from getSemanticMatches until it resolves.
 */
export function preloadSemanticSearch(baseUrl = '/core-embeddings'): void {
  pipelinePromise ??= loadPipeline();
  indexPromise ??= loadIndex(baseUrl);
}

export function isSemanticSearchReady(): boolean {
  return pipelinePromise !== null && indexPromise !== null;
}

export async function releaseSemanticSearchContext(): Promise<void> {}

export async function getSemanticMatches(query: string, topK: number): Promise<SemanticMatch[] | null> {
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
