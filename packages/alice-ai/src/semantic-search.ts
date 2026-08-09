// Semantic ranking layer on top of the lexical RAG scoring in rag.ts.
//
// The lexical scorer only reaches a note through words that literally occur
// in it (even with stemming/full-text matching, it is still word-shaped).
// This module ranks chunks by meaning instead, using a small multilingual
// embedding model (Xenova/multilingual-e5-small) so a French question can
// reach an English-only note and vice versa, and so paraphrases that share
// no vocabulary with a note can still find it.
//
// Design constraints (see project notes, decided 2026-07-31):
// - Multilingual coverage is required (~118 MB quantized) — no smaller
//   multilingual model is actually available; English-only alternatives are
//   not meaningfully smaller once you account for needing two of them.
// - The model download happens automatically for everyone in the
//   background; it must never block chat. Every caller here degrades to
//   "not ready yet" rather than throwing, so retrieval can fall back to the
//   always-available lexical scorer.

export type EmbeddingVector = Float32Array;

export type ChunkEmbeddingIndex = {
  dim: number;
  ids: string[];
  /** Row-major [ids.length, dim] matrix, one L2-normalized vector per chunk. */
  vectors: Float32Array;
};

export type EmbedFn = (text: string) => Promise<EmbeddingVector>;
export type SemanticMatch = { id: string; score: number };

const QUERY_PREFIX = 'query: ';
const PASSAGE_PREFIX = 'passage: ';

/** e5-family models require this literal prefix on the document side. */
export function toPassageText(title: string, content: string): string {
  return `${PASSAGE_PREFIX}${title}. ${content}`;
}

/** e5-family models require this literal prefix on the query side. */
export function toQueryText(query: string): string {
  return `${QUERY_PREFIX}${query}`;
}

export function dotProduct(a: EmbeddingVector, b: Float32Array, bOffset: number, dim: number): number {
  let sum = 0;
  for (let i = 0; i < dim; i += 1) {
    sum += a[i] * b[bOffset + i];
  }
  return sum;
}

/**
 * Cosine similarity against every row of a precomputed embedding index.
 * Vectors are assumed pre-normalized (L2 norm 1), so cosine similarity
 * reduces to a plain dot product — no per-call normalization needed.
 */
export function rankBySimilarity(
  queryVector: EmbeddingVector,
  index: ChunkEmbeddingIndex,
  topK: number,
): SemanticMatch[] {
  const results: SemanticMatch[] = [];
  for (let row = 0; row < index.ids.length; row += 1) {
    const score = dotProduct(queryVector, index.vectors, row * index.dim, index.dim);
    results.push({ id: index.ids[row], score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Combines a lexical ranking and a semantic ranking via Reciprocal Rank
 * Fusion: a chunk's fused score is the sum of 1/(k + rank) across whichever
 * ranking(s) it appears in. RRF needs no score-scale reconciliation between
 * the two very differently-shaped scoring functions, and a chunk that is
 * strong in only one ranking can still win if it is strong enough there.
 */
export function reciprocalRankFusion(
  rankings: string[][],
  k = 60,
): { id: string; score: number }[] {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return Array.from(fused.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
