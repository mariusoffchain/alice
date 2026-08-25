import type { AIBackend, AIBackendStatus, AIResponse, SendMessageOptions } from './ai-backend';
import { sendMessage, usesE2EE, type Message } from './llm';
import { resolveVeniceTransport } from './venice-transport.ts';
import { getPreset, CLOUD_PRESETS, getActiveCloudModelId, getCloudVeniceId, getAliceInstructions } from './ai-preferences';
import {
  assertPrivateCloudEnabled,
  PRIVATE_CLOUD_DISABLED_MESSAGE,
  PRIVATE_CLOUD_ENABLED,
} from './private-cloud-config';
import {
  applyAliceResponseConstraints,
  buildAliceSystemPrompt,
  requiresBufferedAliceResponse,
  withAliceInstructionReminder,
} from './ai-system-prompt';

export class CloudAIBackend implements AIBackend {
  readonly type = 'cloud' as const;
  private _status: AIBackendStatus = { state: 'idle' };
  private _e2ee = false;

  /**
   * E2EE drops assistant history (Venice does not encrypt those turns), so a
   * continuation would have nothing to extend and would re-send prior replies
   * in clear. Refuse it rather than silently weaken the mode.
   */
  get allowsAutoContinuation(): boolean {
    return !this._e2ee;
  }

  async init(): Promise<void> {
    if (!PRIVATE_CLOUD_ENABLED) {
      this._status = { state: 'error', message: PRIVATE_CLOUD_DISABLED_MESSAGE };
      return;
    }

    const cloudModelId = await getActiveCloudModelId();
    this._e2ee = usesE2EE(getCloudVeniceId(cloudModelId));

    try {
      const proxyUrl = process.env.EXPO_PUBLIC_VENICE_PROXY_URL ?? '';
      const directAllowed = process.env.EXPO_PUBLIC_ALLOW_DIRECT_VENICE === 'true';
      if (!proxyUrl.trim() && !directAllowed) {
        throw new Error('Private Cloud requires the Alice account service in this build.');
      }
      // Throws when a public web build has no proxy, or when nothing is
      // configured at all. Either way there is no usable transport.
      resolveVeniceTransport({
        proxyUrl,
        apiKey: process.env.EXPO_PUBLIC_VENICE_API_KEY ?? '',
        isPublicWeb: typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window),
      });
    } catch (err) {
      this._status = {
        state: 'error',
        message: err instanceof Error ? err.message : 'Private Cloud is not configured yet.',
      };
      return;
    }
    this._status = { state: 'ready' };
  }

  status(): AIBackendStatus {
    return this._status;
  }

  async sendMessage(messages: Message[], onChunk?: (chunk: string) => void, options?: SendMessageOptions): Promise<AIResponse> {
    assertPrivateCloudEnabled();

    const [preset, cloudModelId, instructions] = await Promise.all([
      getPreset('cloud'),
      getActiveCloudModelId(),
      getAliceInstructions(),
    ]);
    const params = CLOUD_PRESETS[preset];
    const maxTokens = params.maxTokens;
    const shouldBuffer = requiresBufferedAliceResponse(instructions);
    const responseLanguage = options?.responseLanguage ?? 'en';
    const model = getCloudVeniceId(cloudModelId);
    // Decides whether continuation is allowed for this answer.
    this._e2ee = usesE2EE(model);
    // Withholding onChunk only suppresses the UI stream. The network request
    // still streams, E2EE rejects stream:false, and the buffering happens
    // client-side, after decryption.
    const result = await sendMessage(withAliceInstructionReminder(
      messages,
      instructions,
      responseLanguage,
      options?.strictLanguageRetry,
    ), shouldBuffer ? undefined : onChunk, {
      temperature: options?.temperatureOverride ?? params.temperature,
      maxTokens,
      model,
      systemPrompt: buildAliceSystemPrompt(instructions, responseLanguage),
      requestId: options?.requestId,
    });
    const constrained = applyAliceResponseConstraints(instructions, result.content);
    if (shouldBuffer && onChunk) onChunk(constrained);
    return {
      content: constrained,
      usage: result.usage,
      durationMs: result.durationMs,
      truncated: result.truncated,
      privacyAssurance: result.privacyAssurance,
      backendTimings: result.backendTimings,
    };
  }

  async dispose(): Promise<void> {
    this._status = { state: 'idle' };
  }
}
