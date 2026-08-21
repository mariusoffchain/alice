import type {
  ChatAnchorSuggestion,
  LearnExplorerAnchor,
} from '@alice-wallet/alice-content/src/learn-anchors';
import { stem, tokens } from './suggest.ts';

// Deterministic Explorer suggestions for the chat's "Pour aller plus loin"
// block: a question naming a verified on-chain subject (halving, genesis,
// pizza day…) gets a row pointing at the REAL block or transaction from the
// hand-curated anchor table. Same contract as the course suggestion: the
// model never produces the recommendation, and never an identifier. Pure
// function taking the table as input (node-testable with fixtures);
// suggest-catalog.ts binds CHAT_EXPLORER_SUGGESTIONS for the app.

export const MAX_CHAT_ANCHORS = 2;

export function matchChatAnchors(
  message: string,
  suggestions: ChatAnchorSuggestion[],
): LearnExplorerAnchor[] {
  const queryTokens = new Set(tokens(message).map(stem));
  if (queryTokens.size === 0) return [];
  const matched: LearnExplorerAnchor[] = [];
  for (const { anchor, keywords } of suggestions) {
    if (keywords.some((k) => queryTokens.has(stem(k)))) matched.push(anchor);
    if (matched.length >= MAX_CHAT_ANCHORS) break;
  }
  return matched;
}
