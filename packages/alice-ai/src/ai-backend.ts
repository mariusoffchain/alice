export type { Message } from './llm';
import type { AssuranceLevel } from './venice-attestation-chain.ts';
import type { SupportedLanguage } from './language-policy';
import type { PartKind, PartMessage } from './message-parts';

export type AIBackendType = 'local' | 'cloud' | 'custom';

export type AIBackendStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress?: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AIResponse = {
  content: string;
  usage?: TokenUsage;
  durationMs?: number;
  // True when the provider stopped on max_tokens rather than the model ending
  // its own answer, so the UI can say the reply is incomplete.
  truncated?: boolean;
  /**
   * Technical attestation result for Private Cloud. `attested-unpinned` is not
   * permission to advertise full E2EE verification.
   */
  privacyAssurance?: AssuranceLevel;
  /** Numeric-only runtime diagnostics. Never contains prompts or response text. */
  backendTimings?: Record<string, number>;
};

// Per-message options. Backends that don't support an option ignore it — only
// the cloud backend currently reads `deep` (it swaps the Venice model).
export type SendMessageOptions = {
  deep?: boolean;
  responseLanguage?: SupportedLanguage;
  strictLanguageRetry?: boolean;
  temperatureOverride?: number;
  requestId?: string;
};

export interface AIBackend {
  readonly type: AIBackendType;
  /**
   * False when replaying earlier assistant turns is unsafe, so the caller must
   * not auto-continue a truncated answer. Under Venice E2EE, assistant messages
   * are not encrypted by the protocol, so Alice drops them rather than sending
   * prior replies in clear — which also means a continuation would have no
   * partial answer to extend. Undefined means "no objection".
   */
  readonly allowsAutoContinuation?: boolean;
  /**
   * The part kinds this backend can actually turn into something a model reads.
   * Undefined means the historical baseline: text only. A backend flattens any
   * accepted part to text via `normalizeMessages` before calling its model, so
   * the UI can tell the user up front what will really be understood rather than
   * letting an unread attachment look processed.
   */
  readonly acceptedParts?: readonly PartKind[];
  init(): Promise<void>;
  status(): AIBackendStatus;
  /**
   * Content may be a bare string (every existing caller, unchanged) or a list of
   * typed parts. Accepting parts here is additive: a string flows through exactly
   * as before.
   */
  sendMessage(
    messages: PartMessage[],
    onChunk?: (chunk: string) => void,
    options?: SendMessageOptions,
  ): Promise<AIResponse>;
  dispose(): Promise<void>;
}
