import type {
  LearnCatalogCourse,
  LearnCatalogTutorial,
} from '@alice-wallet/alice-content/src/learn-types';

// Deterministic course/tutorial suggestion for the chat: the model NEVER
// produces the recommendation (a 1B local model invents course codes with
// confidence); this scorer reads the user's message and the catalog metadata,
// and the UI renders the result as a card under Alice's reply. Kept separate
// from Alice's RAG on purpose: the PlanB catalog must not blend into the
// corpus that frames her wallet behaviour. Pure functions take the catalog as
// input (node-testable with fixtures); suggest-catalog.ts binds the generated
// catalog for the app.

export interface LearnSuggestion {
  kind: 'course' | 'tutorial';
  code: string;
  category?: string;
  slug?: string;
  title: string;
  score: number;
}

const STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'que', 'qui', 'quoi',
  'comment', 'pourquoi', 'est', 'sont', 'pour', 'avec', 'sans', 'dans', 'sur', 'mon',
  'ma', 'mes', 'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'ce', 'cette', 'ces',
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'what', 'how',
  'why', 'is', 'are', 'my', 'i', 'you', 'it', 'this', 'that', 'do', 'does', 'can',
  'peux', 'peut', 'faire', 'quel', 'quelle', 'plus', 'pas', 'ne', 'me', 'moi', 'se',
]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Light stemmer: drops a trailing plural marker so "wallets" matches "wallet". */
export function stem(token: string): string {
  return token.replace(/(s|x)$/, '');
}

function scoreAgainst(
  queryTokens: Set<string>,
  haystack: string,
  weight: number,
  matched: Set<string>,
): number {
  const hayTokens = new Set(tokens(haystack).map(stem));
  let hits = 0;
  for (const q of queryTokens) {
    if (hayTokens.has(q)) {
      hits += 1;
      matched.add(q);
    }
  }
  return hits * weight;
}

// Both gates must pass: a lone shared word ("bitcoin") may accumulate weight
// across fields but must never trigger a card on its own.
const MIN_SCORE = 4.5;
const MIN_DISTINCT_TOKENS = 2;

/**
 * Score a catalog against a user message. Returns the best match above the
 * threshold, or null. Deterministic: same message, same result.
 */
export function suggestForMessage(
  message: string,
  lang: string,
  courses: LearnCatalogCourse[],
  tutorials: LearnCatalogTutorial[],
): LearnSuggestion | null {
  const queryTokens = new Set(tokens(message).map(stem));
  if (queryTokens.size === 0) return null;

  let best: LearnSuggestion | null = null;
  const consider = (candidate: LearnSuggestion, matched: Set<string>) => {
    if (matched.size < MIN_DISTINCT_TOKENS) return;
    if (!best || candidate.score > best.score) best = candidate;
  };

  for (const course of courses) {
    const meta = course.i18n[lang] ?? course.i18n.en;
    if (!meta) continue;
    const matched = new Set<string>();
    const score =
      scoreAgainst(queryTokens, meta.name, 3, matched) +
      scoreAgainst(queryTokens, meta.goal, 1.5, matched) +
      scoreAgainst(queryTokens, meta.objectives.join(' '), 1, matched);
    consider({ kind: 'course', code: course.code, title: meta.name, score }, matched);
  }

  for (const tutorial of tutorials) {
    const meta = tutorial.i18n[lang] ?? tutorial.i18n.en;
    if (!meta) continue;
    const matched = new Set<string>();
    const score =
      scoreAgainst(queryTokens, meta.name, 3, matched) +
      scoreAgainst(queryTokens, meta.description, 1.5, matched) +
      scoreAgainst(queryTokens, `${tutorial.category} ${tutorial.subcategory ?? ''}`, 1, matched);
    consider(
      {
        kind: 'tutorial',
        code: `${tutorial.category}/${tutorial.slug}`,
        category: tutorial.category,
        slug: tutorial.slug,
        title: meta.name,
        score,
      },
      matched,
    );
  }

  const typedBest = best as LearnSuggestion | null;
  return typedBest && typedBest.score >= MIN_SCORE ? typedBest : null;
}

/**
 * Session-scoped sobriety, injected as a Set the caller owns: a content
 * suggested once is never suggested again while that Set lives.
 *
 * `langs` lists the catalog languages to score, best score wins: the user may
 * ask in French while Learn is set to English (or the reverse), and the
 * question's own language is what the tokens actually match.
 */
export function takeSuggestion(
  message: string,
  langs: string[],
  courses: LearnCatalogCourse[],
  tutorials: LearnCatalogTutorial[],
  alreadySuggested: Set<string>,
): LearnSuggestion | null {
  let suggestion: LearnSuggestion | null = null;
  for (const lang of new Set(langs)) {
    const candidate = suggestForMessage(message, lang, courses, tutorials);
    if (candidate && (!suggestion || candidate.score > suggestion.score)) suggestion = candidate;
  }
  if (!suggestion) return null;
  if (alreadySuggested.has(suggestion.code)) return null;
  alreadySuggested.add(suggestion.code);
  return suggestion;
}
