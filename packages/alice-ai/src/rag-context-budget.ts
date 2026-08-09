/**
 * Keeps local RAG prompts compact while letting remote backends use the full
 * retrieval context. `isTechnical` is determined from the top lexical match.
 */
export function ragContextChunkLimit(isLocal: boolean, isTechnical: boolean): number {
  if (!isLocal) return 3;
  return isTechnical ? 2 : 1;
}
