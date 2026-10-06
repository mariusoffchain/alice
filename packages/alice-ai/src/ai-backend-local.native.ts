import { fitLocalModelRoles, usesAnswerOnlyLocalMode } from './local-model-message-policy';
import type { AIBackend, AIBackendStatus, AIResponse, SendMessageOptions } from './ai-backend';
import type { Message } from './llm';
import {
  findInstalledLocalModelId,
  getActiveModelId,
  getAliceInstructions,
  getModelPath as resolveModelPath,
  getModelStatus,
  getPreset,
  PRESETS,
  setActiveModelId,
} from './ai-preferences';
import {
  applyAliceResponseConstraints,
  buildAliceLocalSystemPrompt,
  requiresBufferedAliceResponse,
  withAliceInstructionReminder,
} from './ai-system-prompt';
import {
  LOCAL_CONTEXT_TOKENS,
  fitMessagesToContextWithAsyncCounting,
  type LocalContextFit,
} from './local-context-budget';

let llamaContext: any = null;
let loadedModelId: string | null = null;

// Keeps the mandatory system/application context and the current user turn,
// discarding only the oldest conversation turns first. The exact chat
// template is model-specific, so each candidate is measured with the real
// tokenizer instead of an estimate.
async function fitMessagesToContext(
  context: any,
  messages: Message[],
  requestedResponseTokens: number,
  enableThinking: boolean,
  modelId: string,
): Promise<LocalContextFit> {
  return fitMessagesToContextWithAsyncCounting(
    messages,
    requestedResponseTokens,
    LOCAL_CONTEXT_TOKENS,
    async candidate => {
      const formatted = await context.getFormattedChat(
        candidate,
        undefined,
        { enable_thinking: enableThinking },
      );
      return (await context.tokenize(formatted.prompt)).tokens.length;
    },
    candidate => fitLocalModelRoles(candidate, modelId),
  );
}

export class LocalAIBackend implements AIBackend {
  readonly type = 'local' as const;
  private _status: AIBackendStatus = { state: 'idle' };

  async init(): Promise<void> {
    const activeId = await getActiveModelId();

    if (llamaContext && loadedModelId === activeId) {
      this._status = { state: 'ready' };
      return;
    }

    if (llamaContext) {
      await llamaContext.release();
      llamaContext = null;
      loadedModelId = null;
    }

    this._status = { state: 'loading', progress: 0 };

    try {
      let modelId = activeId;
      if ((await getModelStatus(modelId)) !== 'installed') {
        // The stored or default id can point at a file that is not there (an
        // update moved the default, a file was removed): use any complete
        // known file instead of failing while a model sits on disk.
        const installed = await findInstalledLocalModelId();
        if (!installed) throw new Error('No local model installed. Download one to use local AI.');
        modelId = installed;
        await setActiveModelId(modelId);
      }
      const modelPath = await resolveModelPath(modelId);
      this._status = { state: 'loading', progress: 0.5 };

      const llama = await import('llama.rn');
      llamaContext = await llama.initLlama({
        model: modelPath,
        n_ctx: LOCAL_CONTEXT_TOKENS,
        n_threads: 4,
        n_gpu_layers: 0,
        ctx_shift: true,
      });

      loadedModelId = modelId;
      this._status = { state: 'ready' };
    } catch (err) {
      this._status = { state: 'error', message: err instanceof Error ? err.message : 'Model load failed.' };
      throw err;
    }
  }

  status(): AIBackendStatus {
    return this._status;
  }

  async sendMessage(messages: Message[], onChunk?: (chunk: string) => void, options?: SendMessageOptions): Promise<AIResponse> {
    if (!llamaContext) throw new Error('Local model not loaded.');

    // Semantic retrieval has finished by the time generation starts. Release
    // its llama context so low-memory phones do not hold two models at once.
    const { releaseSemanticSearchContext } = await import('./semantic-runtime');
    await releaseSemanticSearchContext();

    const [preset, instructions, activeModelId] = await Promise.all([
      getPreset('local'),
      getAliceInstructions(),
      getActiveModelId(),
    ]);
    const params = PRESETS[preset];
    const shouldBuffer = requiresBufferedAliceResponse(instructions);
    // Keep reasoning from consuming the bounded visible-answer budget.
    const enableThinking = !usesAnswerOnlyLocalMode(activeModelId);

    const responseLanguage = options?.responseLanguage ?? 'en';
    const systemMessage = { role: 'system' as const, content: buildAliceLocalSystemPrompt(instructions, responseLanguage) + (activeModelId === 'smollm3-3b' ? ' /no_think' : '') };
    const remindedMessages = withAliceInstructionReminder(messages, instructions, responseLanguage, options?.strictLanguageRetry);

    // completion() already receives the complete selected history. Keeping the
    // previous KV cache would duplicate that history and eventually cause a
    // false "Context is full" error on a short conversation.
    await llamaContext.clearCache(false);
    const fitted = await fitMessagesToContext(
      llamaContext,
      [systemMessage, ...remindedMessages],
      params.maxTokens,
      enableThinking,
      activeModelId,
    );

    const t0 = Date.now();
    const result = await llamaContext.completion(
      {
        messages: fitted.messages,
        n_predict: fitted.responseTokens,
        temperature: options?.temperatureOverride ?? params.temperature,
        stop: ['<end_of_turn>', '<eos>'],
        enable_thinking: enableThinking,
      },
      shouldBuffer ? undefined : (token: { token: string }) => {
        if (onChunk) onChunk(token.token);
      },
    );

    const constrained = applyAliceResponseConstraints(instructions, result.text);
    if (shouldBuffer && onChunk) onChunk(constrained);
    const usage = result.tokens_evaluated != null ? {
      promptTokens: result.tokens_evaluated ?? fitted.promptTokens,
      completionTokens: result.tokens_predicted ?? 0,
      totalTokens: (result.tokens_evaluated ?? 0) + (result.tokens_predicted ?? 0),
    } : undefined;
    // llama.rn sets stopped_limit when generation stopped at n_predict (the
    // preset's maxTokens) rather than on an end-of-turn token. That is the same
    // "cut off, not finished" condition finish_reason 'length' reports upstream.
    const truncated = Boolean(result.stopped_limit);
    return { content: constrained, usage, durationMs: Date.now() - t0, truncated };
  }

  async dispose(): Promise<void> {
    if (llamaContext) {
      await llamaContext.release();
      llamaContext = null;
      loadedModelId = null;
    }
    this._status = { state: 'idle' };
  }
}

export function isLocalAvailable(): boolean {
  return true;
}
