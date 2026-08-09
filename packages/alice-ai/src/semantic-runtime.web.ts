import type { SemanticMatch } from './semantic-search';

// Metro cannot bundle the dynamic import used by onnxruntime-web yet. Keep
// web builds on the existing lexical RAG path until that loader is compatible.
export function preloadSemanticSearch(): void {}

export function isSemanticSearchReady(): boolean {
  return false;
}

export async function releaseSemanticSearchContext(): Promise<void> {}

export async function getSemanticMatches(
  _query: string,
  _topK: number,
): Promise<SemanticMatch[] | null> {
  return null;
}
