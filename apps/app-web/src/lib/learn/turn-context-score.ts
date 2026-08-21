import type { LearnChapter, LearnCoursePack } from '@alice-wallet/alice-content/src/learn-types';

// Pure half of the Learn turn-context provider (turn-context.ts): mapping a
// question onto the right chapter of a course pack, and trimming that chapter
// to a context-sized excerpt. No fetch, no catalog import, node-testable.

const EXCERPT_CHARS = 1_800;
const MIN_CHAPTER_SCORE = 2;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 3);
}

/** Lexical overlap between the question and a chapter, title counted double. */
export function scoreChapter(queryTokens: readonly string[], chapter: LearnChapter): number {
  if (queryTokens.length === 0) return 0;
  const title = new Set(tokens(chapter.title));
  const body = new Set(tokens(chapter.markdown.slice(0, 4_000)));
  let score = 0;
  for (const token of new Set(queryTokens)) {
    if (title.has(token)) score += 2;
    if (body.has(token)) score += 1;
  }
  return score;
}

export function queryTokens(query: string): string[] {
  return tokens(query);
}

export function pickChapter(query: string, pack: LearnCoursePack): LearnChapter | null {
  const parsed = tokens(query);
  let best: LearnChapter | null = null;
  let bestScore = MIN_CHAPTER_SCORE - 1;
  for (const part of pack.parts) {
    for (const chapter of part.chapters) {
      if (!chapter.markdown.trim()) continue;
      const score = scoreChapter(parsed, chapter);
      if (score > bestScore) {
        best = chapter;
        bestScore = score;
      }
    }
  }
  return best;
}

/** Cuts at a paragraph boundary, so the model never reads half a sentence. */
export function excerptOf(markdown: string, limit = EXCERPT_CHARS): string {
  const clean = markdown.trim();
  if (clean.length <= limit) return clean;
  const head = clean.slice(0, limit);
  const paragraph = head.lastIndexOf('\n\n');
  return (paragraph > limit / 2 ? head.slice(0, paragraph) : head).trim();
}
