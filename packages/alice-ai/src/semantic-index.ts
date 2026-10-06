import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { KnowledgeChunk } from './knowledge-packs';

export type SemanticIndexMetadata = {
  model: string;
  dim: number;
  ids: string[];
  corpusHash: string;
};

/** Exact content and ordering contract shared with build-embeddings.js. */
export function validateSemanticIndexMetadata(
  value: unknown,
  model: string,
  chunks: KnowledgeChunk[],
): SemanticIndexMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const metadata = value as Partial<SemanticIndexMetadata>;
  if (metadata.model !== model || metadata.dim !== 384 || !Array.isArray(metadata.ids)) return null;
  if (!chunks.length || metadata.ids.length !== chunks.length
    || new Set(metadata.ids).size !== metadata.ids.length
    || chunks.some((chunk, index) => metadata.ids![index] !== chunk.id)) return null;
  const hash = bytesToHex(sha256(utf8ToBytes(chunks.map(chunk => (
    `${chunk.id}\n${chunk.sourceHash ?? ''}\n${chunk.title}\n${chunk.content}`
  )).join('\n\n'))));
  if (metadata.corpusHash !== hash) return null;
  return metadata as SemanticIndexMetadata;
}
