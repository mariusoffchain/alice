import type { SemanticMatch } from './semantic-search';
import type { SemanticSearchState } from './semantic-policy';

// Metro cannot bundle onnxruntime-web: its loader dynamic-imports a
// runtime-computed path (`import(a)` in ort.webgpu.bundle.min.mjs and the
// wasm glue), which Metro rejects at build time. Re-verified 2026-08 against
// onnxruntime-web 1.26.0-dev / transformers 4.x by routing this file onto
// semantic-runtime-browser.ts: `expo export` fails with "Invalid call at
// line 8: import(a)". Until Metro learns that pattern, Expo web builds stay
// on the lexical RAG path; the app-web build (Next) carries the real engine.
export function preloadSemanticSearch(): void {}

export function isSemanticSearchReady(): boolean {
  return false;
}

export function getSemanticSearchState(): SemanticSearchState {
  return { status: 'unsupported', progress: null };
}

export function downloadSemanticSearchNow(): void {}

export async function disableSemanticSearch(): Promise<void> {}

export async function releaseSemanticSearchContext(): Promise<void> {}

export async function getSemanticMatches(
  _query: string,
  _topK: number,
): Promise<SemanticMatch[] | null> {
  return null;
}
