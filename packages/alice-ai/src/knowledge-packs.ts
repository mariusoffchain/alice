// Shared shape for a unit of retrievable knowledge, and a small in-memory
// registry of "packs" (groups of chunks with their own origin/version). The
// bundled corpus registers itself as the 'core' pack at module load; this is
// the extension point future downloadable packs (see docs/roadmap) will use
// via registerPack, without rag.ts needing to know where chunks came from.

export type KnowledgeLevel = 'beginner' | 'intermediate' | 'advanced';
export type KnowledgeLocale = 'en' | 'fr';
export type TranslationStatus = 'source' | 'machine' | 'reviewed';

export type KnowledgeChunk = {
  id: string;
  title: string;
  keywords: string[];
  level: KnowledgeLevel;
  content: string;
  retrievalWeight?: number;
  sourcePath?: string;
  theme?: string;
  /** Stable identity shared by source and translated variants. */
  conceptId?: string;
  /** Language of this exact text. */
  locale?: KnowledgeLocale;
  /** Language in which the source note was authored. */
  sourceLocale?: KnowledgeLocale;
  translationStatus?: TranslationStatus;
  /** Hash of the source used to invalidate stale generated translations. */
  sourceHash?: string;
  /** Editorial controls preserved from the source manifest. */
  phase?: number;
  priority?: string;
  status?: string;
  surface?: string;
};

export type KnowledgePack = {
  id: string;
  version: string;
  /** Primary language of this pack's chunk content, for future pack-selection UI. */
  language: 'en' | 'fr' | 'multi';
  /** Where this pack comes from: 'bundled' ships with the app, 'downloaded' was fetched at runtime. */
  source: 'bundled' | 'downloaded';
  /** Disabled packs stay installed but never participate in retrieval. */
  enabledByDefault?: boolean;
  chunks: KnowledgeChunk[];
};

const registeredPacks = new Map<string, KnowledgePack>();
const enabledPacks = new Set<string>();
let registryRevision = 0;

export function registerPack(pack: KnowledgePack): void {
  const existing = registeredPacks.has(pack.id);
  registeredPacks.set(pack.id, pack);
  if (!existing && pack.enabledByDefault !== false) enabledPacks.add(pack.id);
  if (pack.enabledByDefault === false) enabledPacks.delete(pack.id);
  registryRevision += 1;
}

export function unregisterPack(packId: string): void {
  if (registeredPacks.delete(packId)) registryRevision += 1;
  enabledPacks.delete(packId);
}

export function getRegisteredPacks(): KnowledgePack[] {
  return Array.from(registeredPacks.values());
}

export function setKnowledgePackEnabled(packId: string, enabled: boolean): void {
  if (!registeredPacks.has(packId)) return;
  const changed = enabled ? !enabledPacks.has(packId) : enabledPacks.has(packId);
  if (enabled) enabledPacks.add(packId);
  else enabledPacks.delete(packId);
  if (changed) registryRevision += 1;
}

export function isKnowledgePackEnabled(packId: string): boolean {
  return enabledPacks.has(packId);
}

export function getKnowledgePackRevision(): number {
  return registryRevision;
}

export function getAllChunks(options: { includeDisabled?: boolean } = {}): KnowledgeChunk[] {
  return getRegisteredPacks()
    .filter(pack => options.includeDisabled || enabledPacks.has(pack.id))
    .flatMap(pack => pack.chunks);
}

export function preferKnowledgeLocale(
  chunks: KnowledgeChunk[],
  targetLanguage?: KnowledgeLocale,
): KnowledgeChunk[] {
  if (!targetLanguage) return dedupeById(chunks);

  const groups = new Map<string, KnowledgeChunk[]>();
  const order: string[] = [];
  for (const chunk of chunks) {
    const conceptId = chunk.conceptId ?? chunk.id;
    if (!groups.has(conceptId)) order.push(conceptId);
    groups.set(conceptId, [...(groups.get(conceptId) ?? []), chunk]);
  }

  return order.map(conceptId => {
    const variants = groups.get(conceptId)!;
    return variants.find(chunk => chunk.locale === targetLanguage) ?? variants[0];
  });
}

function dedupeById(chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  const seen = new Set<string>();
  return chunks.filter(chunk => {
    if (seen.has(chunk.id)) return false;
    seen.add(chunk.id);
    return true;
  });
}
