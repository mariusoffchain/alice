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

const TOO_LONG_ERROR = 'Local prompt is too long for the model context.';

type TaggedMessage = { message: Message; mandatory: boolean };

/**
 * Every system-role message (the leading persona prompt as well as any
 * RAG/Learn/profile/reminder context appended later) and the latest user turn are
 * mandatory: history is always removed before any of them, and only the
 * appended application context can then give way, largest message first. Classification uses the message's
 * original role only, never its text, so nothing can impersonate history (or
 * escape being treated as history) by what it says.
 */
function tagMandatoryMessages(messages: Message[]): TaggedMessage[] {
  const lastUserIndex = messages.findLastIndex(message => message.role === 'user');
  const lastIndex = messages.length - 1;
  return messages.map((message, index) => ({
    message,
    mandatory: message.role === 'system' || index === lastUserIndex || index === lastIndex,
  }));
}

/**
 * Once no history is left, the application context appended after the
 * leading prompt (RAG notes, Learn excerpt, profile, reminder) is the only
 * thing that can still give way: the largest of those system messages is
 * dropped whole. The leading prompt and the latest user turn never are, so a
 * turn fails only when the policy and the question alone exceed the budget.
 * Returns null when nothing can be dropped.
 */
function dropLargestApplicationContext(tagged: TaggedMessage[]): TaggedMessage[] | null {
  let largest = -1;
  for (let index = 1; index < tagged.length; index += 1) {
    const { message } = tagged[index];
    if (message.role !== 'system') continue;
    if (largest === -1 || message.content.length > tagged[largest].message.content.length) largest = index;
  }
  if (largest === -1) return null;
  return tagged.filter((_, index) => index !== largest);
}

/**
 * Drops the oldest removable conversational turn, keeping every mandatory
 * message in place and complete user/assistant pairs together. Returns null
 * once no removable message is left.
 */
function dropOldestHistoryTurn(tagged: TaggedMessage[]): TaggedMessage[] | null {
  const index = tagged.findIndex(entry => !entry.mandatory);
  if (index === -1) return null;
  // App context may sit between a question and its answer. Ignore system
  // entries when finding the paired reply, but preserve them in place.
  const nextIndex = tagged.findIndex((entry, candidateIndex) =>
    candidateIndex > index && entry.message.role !== 'system');
  const next = tagged[nextIndex];
  const dropsCompleteTurn = tagged[index].message.role === 'user'
    && next != null && !next.mandatory && next.message.role === 'assistant';
  return tagged.filter((_, candidateIndex) => candidateIndex !== index
    && !(dropsCompleteTurn && candidateIndex === nextIndex));
}

/**
 * llama-server does not expose its tokenizer before the request. This bounded
 * estimate keeps all mandatory system/application context and the current
 * turn, and removes complete old conversational turns first, oldest first.
 * `adaptRoles` lets a model-specific role mapping (e.g. SmolLM3) be applied to
 * each candidate right before it is measured, without affecting which
 * messages are classified as history.
 */
export function fitMessagesToEstimatedLocalContext(
  messages: Message[],
  requestedResponseTokens: number,
  contextTokens: number = LOCAL_CONTEXT_TOKENS,
  adaptRoles: (messages: Message[]) => Message[] = messages => messages,
): LocalContextFit {
  let tagged = tagMandatoryMessages(messages);

  while (true) {
    const candidate = adaptRoles(tagged.map(entry => entry.message));
    const promptTokens = candidate.reduce((sum, message) => sum + estimatedMessageTokens(message), 0);
    const responseTokens = Math.min(
      requestedResponseTokens,
      contextTokens - promptTokens - LOCAL_CONTEXT_SAFETY_TOKENS,
    );
    if (responseTokens >= LOCAL_MIN_RESPONSE_TOKENS) {
      return { messages: candidate, promptTokens, responseTokens };
    }
    const next = dropOldestHistoryTurn(tagged) ?? dropLargestApplicationContext(tagged);
    if (!next) throw new Error(TOO_LONG_ERROR);
    tagged = next;
  }
}

/**
 * Same mandatory-context-preserving trim, for backends whose chat template and
 * tokenizer are only available at runtime (llama.rn). `countPromptTokens`
 * must count the actual formatted prompt for the candidate it is given, not
 * estimate it, since the exact template is model-specific.
 */
export async function fitMessagesToContextWithAsyncCounting(
  messages: Message[],
  requestedResponseTokens: number,
  contextTokens: number,
  countPromptTokens: (messages: Message[]) => Promise<number>,
  adaptRoles: (messages: Message[]) => Message[] = messages => messages,
): Promise<LocalContextFit> {
  let tagged = tagMandatoryMessages(messages);

  while (true) {
    const candidate = adaptRoles(tagged.map(entry => entry.message));
    const promptTokens = await countPromptTokens(candidate);
    const responseTokens = Math.min(
      requestedResponseTokens,
      contextTokens - promptTokens - LOCAL_CONTEXT_SAFETY_TOKENS,
    );
    if (responseTokens >= LOCAL_MIN_RESPONSE_TOKENS) {
      return { messages: candidate, promptTokens, responseTokens };
    }
    const next = dropOldestHistoryTurn(tagged) ?? dropLargestApplicationContext(tagged);
    if (!next) throw new Error(TOO_LONG_ERROR);
    tagged = next;
  }
}
