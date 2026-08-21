import type { PlaygroundView } from '../playground-signals.ts';

// Which chapters earn a "Try it in the Playground" button, and which
// Playground view it opens. Hand-curated and deterministic like
// explorer-suggest: the model never produces the recommendation. Scoped to
// BTC101 to start, extended course by course once the mapping proves right;
// a chapter outside the list simply shows no button, which is the safe
// failure.
//
// Order matters: the first matching rule wins, so the specific practices
// (backup, receive, coin control) are tested before the broad send/payment
// net.

const COURSES = new Set(['btc101']);

const RULES: { pattern: RegExp; view: PlaygroundView }[] = [
  { pattern: /back.{0,4}up|recovery|seed|sauvegarde|r[ée]cup[ée]ration/i, view: 'backup' },
  { pattern: /receiv|recevoir|r[ée]ception/i, view: 'receive' },
  { pattern: /utxo|coin control|coin selection/i, view: 'coins' },
  { pattern: /send|sending|transaction|payment|fee|envoy|envoi|paiement|frais/i, view: 'send' },
  { pattern: /wallet|portefeuille/i, view: 'home' },
];

export function playgroundBridgeFor(code: string, chapterTitle: string): PlaygroundView | null {
  if (!COURSES.has(code.toLowerCase())) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(chapterTitle)) return rule.view;
  }
  return null;
}

// Same rules against a free-text chat message, for the "to go further" block
// under Alice's replies: a question about sending, backups or coin control
// earns a "try it with training sats" row. The caller enforces the
// once-per-session cap; this stays a pure matcher.
export function playgroundSuggestionFor(message: string): PlaygroundView | null {
  for (const rule of RULES) {
    if (rule.pattern.test(message)) return rule.view;
  }
  return null;
}
