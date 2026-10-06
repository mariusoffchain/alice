/**
 * Picks how much knowledge-context text (retrieved RAG chunks plus an optional
 * "Learn" excerpt) a prompt is allowed to carry, and fits real content inside
 * that budget deterministically and dependency-free.
 */

/** Absolute ceiling any normalized budget can reach, regardless of backend. */
const ABSOLUTE_MAX_BUDGET = 12000;

/**
 * Any chunk or Learn excerpt longer than the absolute max budget can never fit
 * as a whole unit no matter how the budget is normalized, so we reject such
 * input with a single O(1) length check instead of running whitespace
 * normalization or substring scans over it. This keeps cost bounded for
 * arbitrarily large downloaded content without needing to read it.
 */
const SCAN_CAP = ABSOLUTE_MAX_BUDGET;

/**
 * Retrieval realistically returns a small, bounded set of candidate chunks.
 * Capping how many we even look at guards against a pathological caller
 * passing an unbounded array; chunks beyond this index are dropped silently
 * (not reported) to avoid building an unbounded omittedIds list either.
 */
const MAX_CHUNKS_CONSIDERED = 500;

const LEARN_LABEL_MAX_CHARS = 240;
const LEARN_PARAGRAPH_MIN_SUBSTANTIAL_CHARS = 80;

export interface KnowledgeChunk {
  id: string;
  text: string;
}

export interface KnowledgeLearnInput {
  label: string;
  excerpt: string;
}

export interface FitKnowledgeContextInput {
  header: string;
  chunks: KnowledgeChunk[];
  learn: KnowledgeLearnInput | null;
  maxChars: number;
}

export interface FitKnowledgeContextResult {
  ragContext: string | null;
  learnContext: string | null;
  selectedIds: string[];
  omittedIds: string[];
  duplicateLearnParagraphs: number;
}

/** Local prompts stay compact; cloud backends can carry the full context. */
export function knowledgeContextCharLimit(isLocal: boolean): number {
  return isLocal ? 6000 : 12000;
}

function normalizeMaxChars(maxChars: number): number {
  if (!Number.isFinite(maxChars)) return 0;
  const floored = Math.floor(maxChars);
  if (floored < 0) return 0;
  if (floored > ABSOLUTE_MAX_BUDGET) return ABSOLUTE_MAX_BUDGET;
  return floored;
}

/** Collapses whitespace runs and lowercases for literal (non-fuzzy) comparison. */
function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Truncates to at most maxLen UTF-16 code units without splitting a surrogate pair. */
function truncateLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) return label;
  let sliced = label.slice(0, maxLen);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }
  return sliced;
}

/** Splits on blank lines; a single linear pass, safe for the capped excerpt size. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function fitKnowledgeContext(input: FitKnowledgeContextInput): FitKnowledgeContextResult {
  const maxChars = normalizeMaxChars(input.maxChars);

  const selectedIds: string[] = [];
  const omittedIds: string[] = [];
  const ragParts: string[] = [];
  const seenChunkNormalized = new Set<string>();
  const headerLen = input.header.length;

  let ragBuilt = false;
  let ragLen = 0;

  const chunksToConsider = input.chunks.slice(0, MAX_CHUNKS_CONSIDERED);
  for (const chunk of chunksToConsider) {
    const text = chunk.text;
    if (text.length === 0) {
      omittedIds.push(chunk.id);
      continue;
    }
    if (text.length > SCAN_CAP) {
      // Can never fit whole within any valid budget; skip without normalizing.
      omittedIds.push(chunk.id);
      continue;
    }
    const normalized = normalizeForCompare(text);
    if (!normalized || seenChunkNormalized.has(normalized)) {
      omittedIds.push(chunk.id);
      continue;
    }
    const additional = ragBuilt ? 2 + text.length : headerLen + 2 + text.length;
    if (ragLen + additional > maxChars) {
      // Doesn't fit yet; keep scanning in case a smaller later chunk fits.
      omittedIds.push(chunk.id);
      continue;
    }
    seenChunkNormalized.add(normalized);
    ragParts.push(text);
    ragLen += additional;
    ragBuilt = true;
    selectedIds.push(chunk.id);
  }

  const ragContext = ragBuilt ? [input.header, ...ragParts].join('\n\n') : null;

  let learnContext: string | null = null;
  let duplicateLearnParagraphs = 0;

  const learnBudget = maxChars - ragLen;
  if (input.learn && learnBudget > 0) {
    const label = truncateLabel(input.learn.label, LEARN_LABEL_MAX_CHARS).trim();

    // Look at a bounded prefix, but never turn the partial trailing paragraph
    // into evidence. Its unseen ending may contain the necessary qualification.
    const head = input.learn.excerpt.slice(0, SCAN_CAP + 2);
    const boundary = head.lastIndexOf('\n\n');
    const excerpt = input.learn.excerpt.length <= SCAN_CAP
      ? input.learn.excerpt
      : boundary >= 0 ? head.slice(0, boundary) : '';

    const rawParagraphs = splitParagraphs(excerpt);
    const ragNormalizedTexts = ragParts.map(normalizeForCompare);

    const seenParagraphNormalized = new Set<string>();
    const keptParagraphs: string[] = [];
    for (const paragraph of rawParagraphs) {
      const normalized = normalizeForCompare(paragraph);
      if (seenParagraphNormalized.has(normalized)) {
        duplicateLearnParagraphs += 1;
        continue;
      }
      seenParagraphNormalized.add(normalized);

      const isSubstantial = normalized.length >= LEARN_PARAGRAPH_MIN_SUBSTANTIAL_CHARS;
      const isContainedInRag =
        isSubstantial && ragNormalizedTexts.some((ragText) => ragText.includes(normalized));
      if (isContainedInRag) {
        duplicateLearnParagraphs += 1;
        continue;
      }

      keptParagraphs.push(paragraph);
    }

    let learnRunningLen = 0;
    let learnBuilt = false;
    const fittedParagraphs: string[] = [];
    for (const paragraph of keptParagraphs) {
      const additional = learnBuilt ? 2 + paragraph.length : label.length + 1 + paragraph.length;
      if (learnRunningLen + additional > learnBudget) {
        // Keep a coherent prefix instead of skipping to a later dependent claim.
        break;
      }
      fittedParagraphs.push(paragraph);
      learnRunningLen += additional;
      learnBuilt = true;
    }

    if (learnBuilt && label) {
      learnContext = `${label}\n${fittedParagraphs.join('\n\n')}`;
    }
  }

  return {
    ragContext,
    learnContext,
    selectedIds,
    omittedIds,
    duplicateLearnParagraphs,
  };
}
