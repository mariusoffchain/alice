import type { AIBackend } from './ai-backend';
import type { Message } from './llm';
import { generateWithContinuation, type GenerationOutcome } from './generate-with-continuation.ts';
import { parseAliceMemoryResponse, type AliceMemoryCandidate } from './alice-memory-core.ts';
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
  deep: boolean;
  allowContinuation: boolean;
  targetLanguage: SupportedLanguage;
  requestId?: string;
  onText?: (visibleText: string) => void;
}): Promise<GenerationOutcome & {
  memoryCandidates: AliceMemoryCandidate[];
  attempts: number;
  firstDisplayMs?: number;
}> {
  const started = now();
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
      input.deep,
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
      if (input.onText && !released && parsed.visibleText) {
        firstDisplayMs ??= now() - started;
        input.onText(parsed.visibleText);
      }
      return {
        ...result,
        text: parsed.visibleText,
        memoryCandidates: parsed.candidates,
        attempts: attempt + 1,
        firstDisplayMs,
      };
    }
  }

  throw new WrongResponseLanguageError(input.targetLanguage);
}
