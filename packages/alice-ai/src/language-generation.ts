import type { AIBackend } from './ai-backend';
import type { Message } from './llm';
import { generateWithContinuation, type GenerationOutcome } from './generate-with-continuation.ts';
import { parseAliceMemoryResponse, type AliceMemoryCandidate } from './alice-memory-core.ts';
import { withLiveValueCaveat } from './live-value-caveat.ts';
import { answerRuleNoteIdsInMessages, withAnswerRuleCorrections } from './answer-rules.ts';
import {
  detectTextLanguage,
  isResponseLanguageAcceptable,
  localizedLanguageFailure,
  type SupportedLanguage,
} from './language-policy.ts';

const MEMORY_MARKER = '<alice_memory>';
const LANGUAGE_GATE_CHARACTERS = 96;

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

/**
 * The model writes private memory metadata at the end of its answer. Hold only
 * a possible partial marker, so visible text can stream without ever flashing
 * protocol output when the marker is split across network chunks.
 */
export function visibleStreamingText(text: string): string {
  const lower = text.toLowerCase();
  const markerStart = lower.indexOf(MEMORY_MARKER);
  if (markerStart >= 0) return text.slice(0, markerStart).trimEnd();
  for (let length = MEMORY_MARKER.length - 1; length > 0; length -= 1) {
    if (lower.endsWith(MEMORY_MARKER.slice(0, length))) {
      return text.slice(0, -length).trimEnd();
    }
  }
  return text;
}

export class WrongResponseLanguageError extends Error {
  readonly targetLanguage: SupportedLanguage;

  constructor(targetLanguage: SupportedLanguage) {
    super(localizedLanguageFailure(targetLanguage));
    this.name = 'WrongResponseLanguageError';
    this.targetLanguage = targetLanguage;
  }
}

export async function generateLanguageChecked(input: {
  backend: AIBackend;
  history: Message[];
  allowContinuation: boolean;
  targetLanguage: SupportedLanguage;
  requestId?: string;
  onText?: (visibleText: string) => void;
}): Promise<GenerationOutcome & {
  memoryCandidates: AliceMemoryCandidate[];
  attempts: number;
  firstDisplayMs?: number;
  /** Never-claim checks (answer-rules.ts) whose correction was appended. */
  answerRuleCorrections: string[];
}> {
  const started = now();
  // The rule notes are read from the system turns actually sent, and the
  // question lets a check defer to what the user stated (a threshold).
  const answerRuleNoteIds = answerRuleNoteIdsInMessages(input.history);
  const question = input.history.findLast(message => message.role === 'user')?.content ?? '';
  let firstDisplayMs: number | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let released = false;
    const streamVisible = (fullText: string) => {
      if (!input.onText) return;
      const visible = visibleStreamingText(fullText);
      if (!visible) return;
      if (!released) {
        const detected = detectTextLanguage(visible);
        if (detected && detected.language !== input.targetLanguage) return;
        if (!detected && visible.length < LANGUAGE_GATE_CHARACTERS) return;
        released = true;
        firstDisplayMs ??= now() - started;
      }
      input.onText(visible);
    };
    const result = await generateWithContinuation(
      input.backend,
      input.history,
      input.allowContinuation,
      streamVisible,
      {
        responseLanguage: input.targetLanguage,
        requestId: input.requestId,
        strictLanguageRetry: attempt === 1,
        temperatureOverride: attempt === 1 ? 0.1 : undefined,
      },
    );
    const parsed = parseAliceMemoryResponse(result.text);
    if (isResponseLanguageAcceptable(parsed.visibleText, input.targetLanguage)) {
      // Output guard: a present-tense network figure or state is invented,
      // since no such feed exists; the caveat rides with the final text on
      // every backend, streamed or buffered.
      // Output guard: a claim the retrieved note rules out (an operator that
      // blocks an exit, a 2-of-3 that needs three signatures, a replacement
      // conditional on an opt-in flag) gets a correction after the answer.
      const corrected = withAnswerRuleCorrections(parsed.visibleText, input.targetLanguage, answerRuleNoteIds, question);
      const visibleText = withLiveValueCaveat(corrected.text, input.targetLanguage);
      if (input.onText && visibleText && (!released || visibleText !== parsed.visibleText)) {
        firstDisplayMs ??= now() - started;
        input.onText(visibleText);
      }
      return {
        ...result,
        text: visibleText,
        memoryCandidates: parsed.candidates,
        attempts: attempt + 1,
        firstDisplayMs,
        answerRuleCorrections: corrected.applied,
      };
    }
  }

  throw new WrongResponseLanguageError(input.targetLanguage);
}
