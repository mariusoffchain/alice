import type { Message } from './llm';
import type { RagTurnContext } from './rag';

const PRIVATE_CONTEXT_RULE = 'The preceding encrypted reference transcript is a completed exchange, '
  + 'not a pending request. Use it only to resolve references in the final user message. Answer the '
  + 'final user message alone and never repeat the earlier answer.';
const PRIVATE_CONTEXT_LIMIT = 1200;

function boundedTranscriptText(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= PRIVATE_CONTEXT_LIMIT) return normalized;
  return `${normalized.slice(0, PRIVATE_CONTEXT_LIMIT)}…`;
}

function privateCloudHistory(history: Message[], needsConversationContext: boolean): Message[] {
  const latest = history.at(-1);
  if (!latest || latest.role !== 'user') return [];
  if (!needsConversationContext) return [latest];

  const completed = history.slice(0, -1);
  let assistantIndex = -1;
  for (let index = completed.length - 1; index >= 0; index--) {
    if (completed[index]?.role === 'assistant') {
      assistantIndex = index;
      break;
    }
  }

  if (assistantIndex < 0) return [latest];
  let userIndex = -1;
  for (let index = assistantIndex - 1; index >= 0; index--) {
    if (completed[index]?.role === 'user') {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return [latest];

  // Venice encrypts user/system turns but not assistant turns. Encode the last
  // completed exchange as a user-role reference transcript so both sides stay
  // encrypted without elevating earlier user text to system authority.
  const transcript = JSON.stringify({
    previousUser: boundedTranscriptText(completed[userIndex].content),
    previousAlice: boundedTranscriptText(completed[assistantIndex].content),
  });
  return [
    {
      role: 'user',
      content: `[Encrypted reference transcript — already answered]\n${transcript}`,
    },
    latest,
  ];
}

export function composeGenerationHistory(
  history: Message[],
  context: RagTurnContext,
  pedagogicalContext: string,
  assistantHistoryDropped = false,
  memoryContext = '',
  memoryCaptureInstruction = '',
  turnDirective = '',
  needsConversationContext = false,
): Message[] {
  const outboundHistory = assistantHistoryDropped
    ? privateCloudHistory(history, needsConversationContext)
    : [...history];
  const latest = outboundHistory.at(-1);
  if (!latest || latest.role !== 'user') return [...history];
  const hasPrivateContext = assistantHistoryDropped && outboundHistory.length > 1;

  const internalContext = [
    context.ragContext ? `[Retrieved knowledge]\n${context.ragContext}` : null,
    context.localContext ? `[Device-local summary]\n${context.localContext}` : null,
    pedagogicalContext ? `[Pedagogical context]\n${pedagogicalContext}` : null,
    memoryContext ? `[Personal memory]\n${memoryContext}` : null,
    memoryCaptureInstruction ? `[Private memory protocol]\n${memoryCaptureInstruction}` : null,
    turnDirective ? `[Current turn intent]\n${turnDirective}` : null,
    hasPrivateContext
      ? `[Conversation rule]\n${PRIVATE_CONTEXT_RULE}`
      : null,
  ].filter(Boolean).join('\n\n');

  if (!internalContext) return outboundHistory;
  return [
    ...outboundHistory.slice(0, -1),
    { role: 'system', content: internalContext },
    latest,
  ];
}
