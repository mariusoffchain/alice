import type { LearnQuizQuestion } from '@alice-wallet/alice-content/src/learn-types';

// Quiz questions come human-written and human-reviewed from the corpus; the
// app only selects and shuffles. The shuffle is seeded by the question id so a
// given question always shows its choices in the same order (stable across
// renders and sessions, no Date/Math.random in render paths).

function seededHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface QuizChoice {
  text: string;
  correct: boolean;
}

export function shuffledChoices(question: LearnQuizQuestion): QuizChoice[] {
  const choices: QuizChoice[] = [
    { text: question.answer, correct: true },
    ...question.wrongAnswers.map((text) => ({ text, correct: false })),
  ];
  let seed = seededHash(question.id);
  for (let i = choices.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const j = seed % (i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return choices;
}

/** Questions attached to the chapters of one part, reviewed ones first. */
export function questionsForChapters(
  all: LearnQuizQuestion[],
  chapterIds: (string | null)[],
  limit: number,
): LearnQuizQuestion[] {
  const wanted = new Set(chapterIds.filter(Boolean) as string[]);
  return all
    .filter((q) => wanted.has(q.chapterId))
    .sort((a, b) => Number(b.reviewed) - Number(a.reviewed) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
