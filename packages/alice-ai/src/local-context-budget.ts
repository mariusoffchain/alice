import type { Message } from './llm';

export const LOCAL_CONTEXT_TOKENS = 4096;
export const LOCAL_CONTEXT_SAFETY_TOKENS = 64;
export const LOCAL_MIN_RESPONSE_TOKENS = 128;

export type LocalContextFit = {
  messages: Message[];
  promptTokens: number;
  responseTokens: number;
};

function estimatedMessageTokens(message: Message): number {
  return Math.ceil((message.content.length + 16) / 4);
}

/**
 * llama-server does not expose its tokenizer before the request. This bounded
 * estimate keeps the latest turn and removes complete old turns first.
 */
export function fitMessagesToEstimatedLocalContext(
  messages: Message[],
  requestedResponseTokens: number,
  contextTokens: number = LOCAL_CONTEXT_TOKENS,
): LocalContextFit {
  const system = messages[0]?.role === 'system' ? messages[0] : undefined;
  let recent = system ? messages.slice(1) : [...messages];

  while (recent.length > 1) {
    const fitted = system ? [system, ...recent] : recent;
    const promptTokens = fitted.reduce((sum, message) => sum + estimatedMessageTokens(message), 0);
    const responseTokens = Math.min(
      requestedResponseTokens,
      contextTokens - promptTokens - LOCAL_CONTEXT_SAFETY_TOKENS,
    );
    if (responseTokens >= LOCAL_MIN_RESPONSE_TOKENS) {
      return { messages: fitted, promptTokens, responseTokens };
    }
    const dropsCompleteTurn = recent[0]?.role === 'user' && recent[1]?.role === 'assistant';
    recent = recent.slice(dropsCompleteTurn ? 2 : 1);
  }

  const fitted = system ? [system, ...recent] : recent;
  const promptTokens = fitted.reduce((sum, message) => sum + estimatedMessageTokens(message), 0);
  const responseTokens = Math.min(
    requestedResponseTokens,
    contextTokens - promptTokens - LOCAL_CONTEXT_SAFETY_TOKENS,
  );
  if (responseTokens < LOCAL_MIN_RESPONSE_TOKENS) {
    throw new Error('Local prompt is too long for the model context.');
  }
  return { messages: fitted, promptTokens, responseTokens };
}
