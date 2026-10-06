// Frozen from private commit 146bd917; benchmark baseline, never production code.
import type { AliceTurnPlan } from './baseline-planner.ts';
type Message = { role: string; content: string };

export function baselineRetrievalQueryForTurn(
  history: Message[],
  plan: AliceTurnPlan,
): string | null {
  if (!plan.retrievalQuery || !plan.needsConversationContext) return plan.retrievalQuery;

  const followUpSubject = plan.retrievalQuery
    .replace(/\b(can|could|would|will|you|please|explain|expand|elaborate|tell|me|more|further|that|this|it|and|but|what|about|why|how|peux|pourrais|pourriez|tu|vous|expliquer|explique|approfondir|approfondis|développe|dis|m['’]en|plus|ça|cela|ceci|et|mais|quoi|pourquoi|comment)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (let index = history.length - 2; index >= 0; index--) {
    const message = history[index];
    if (message?.role === 'user' && message.content.trim()) {
      return followUpSubject
        ? `${message.content.trim()}\nFollow-up topic: ${followUpSubject}`
        : message.content.trim();
    }
  }
  return plan.retrievalQuery;
}
