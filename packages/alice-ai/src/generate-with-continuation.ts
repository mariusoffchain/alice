import type { AIBackend, SendMessageOptions, TokenUsage } from './ai-backend';
import type { Message } from './llm';

// Kept apart from `chat-context.tsx` so it can be tested: that module pulls in
// React, react-native and AsyncStorage, none of which load outside Metro. Every
// import here is type-only, so this file has no runtime dependency at all.

// A user should never be left in front of an unfinished sentence. When the
// provider stops on max_tokens we silently ask Alice to pick up where she left
// off and stitch the pieces together, so the cut is invisible.
export const CONTINUE_INSTRUCTION =
  'Continue your previous answer from exactly where it stopped. Do not repeat anything you already wrote, do not restate the question, do not start a new introduction. Pick up mid-sentence if that is where you stopped, and bring the answer to a proper conclusion.';
export const CONTINUE_INSTRUCTIONS = {
  en: CONTINUE_INSTRUCTION,
  fr: `Continue ta réponse précédente exactement à l'endroit où elle s'est arrêtée. Ne répète rien, ne reformule pas la question et ne commence pas une nouvelle introduction. Reprends au milieu de la phrase si nécessaire et termine correctement la réponse, entièrement en français.`,
} as const;

// COST: this is the only place where one user message can bill more than one
// API call. A single answer costs at most 1 + MAX_AUTO_CONTINUATIONS calls
// (currently 2: one initial call plus one continuation). Each continuation
// re-sends the whole conversation plus the answer so far, so input tokens are
// re-billed every round while output tokens are billed once per round.
// Deliberately held at 1 continuation for the beta, until real Venice costs are
// measured, raising it multiplies the worst-case cost of a single answer.
export const MAX_AUTO_CONTINUATIONS = 1;

export type GenerationOutcome = {
  text: string;
  usage?: TokenUsage;
  durationMs?: number;
  truncated: boolean;
  backendTimings?: Record<string, number>;
};

// Runs one generation, then transparently continues it while the provider keeps
// reporting a length cut. `onText` receives the full text so far, so streaming
// into the UI stays seamless across rounds.
export async function generateWithContinuation(
  backend: AIBackend,
  history: Message[],
  allowContinuation: boolean,
  onText: (fullSoFar: string) => void,
  options?: Omit<SendMessageOptions, 'requestId'> & { requestId?: string },
): Promise<GenerationOutcome> {
  const working = [...history];
  let full = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let durationMs = 0;
  let truncated = false;
  let backendTimings: Record<string, number> | undefined;

  for (let round = 0; round <= MAX_AUTO_CONTINUATIONS; round++) {
    const base = full;
    let streamed = '';
    let result;
    try {
      result = await backend.sendMessage(working, chunk => {
        streamed += chunk;
        onText(base + streamed);
      }, {
        ...options,
        requestId: options?.requestId ? `${options.requestId}_c${round}` : undefined,
      });
    } catch (err) {
      // Round 0 failing means there is nothing to show: let the caller handle
      // it as a normal error. A continuation failing is different, the user
      // already has a real partial answer they paid for, so keep it and mark it
      // truncated instead of replacing it with an error.
      if (round === 0) throw err;
      console.warn('[chat] continuation round failed, keeping partial answer:', err);
      return {
        text: base,
        usage: promptTokens || completionTokens
          ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
          : undefined,
        durationMs: durationMs || undefined,
        truncated: true,
      };
    }

    const segment = result.content || streamed;
    full = base + segment;
    onText(full);

    promptTokens += result.usage?.promptTokens ?? 0;
    completionTokens += result.usage?.completionTokens ?? 0;
    durationMs += result.durationMs ?? 0;
    backendTimings = result.backendTimings ?? backendTimings;
    truncated = Boolean(result.truncated);

    if (!truncated || !allowContinuation) break;
    // Nothing visible came back, a reasoning model can burn the whole budget
    // before writing a word. There is no partial answer to extend, and asking
    // anyway makes Alice reply "where did I stop?", so leave it truncated.
    if (!full.trim()) break;
    // A continuation that adds nothing means we are looping; stop.
    if (round > 0 && !segment.trim()) break;
    // Feed the partial answer back so the model sees exactly what to extend.
    working.push({ role: 'assistant', content: full });
    working.push({
      role: 'user',
      content: CONTINUE_INSTRUCTIONS[options?.responseLanguage ?? 'en'],
    });
  }

  return {
    text: full,
    usage: promptTokens || completionTokens
      ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
      : undefined,
    durationMs: durationMs || undefined,
    truncated,
    backendTimings,
  };
}
