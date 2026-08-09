import type { AIBackend, AIBackendStatus, AIResponse, SendMessageOptions } from './ai-backend';
import type { Message } from './llm';
import { getPreset, PRESETS, getActiveModelId, getModelPath as resolveModelPath, getAliceInstructions, getModelStatus } from './ai-preferences';
import {
  applyAliceResponseConstraints,
  buildAliceLocalSystemPrompt,
  requiresBufferedAliceResponse,
  withAliceInstructionReminder,
} from './ai-system-prompt';
import {
  LOCAL_CONTEXT_TOKENS,
  LOCAL_CONTEXT_SAFETY_TOKENS,
  LOCAL_MIN_RESPONSE_TOKENS,
} from './local-context-budget';

let llamaContext: any = null;
let loadedModelId: string | null = null;

async function fitMessagesToContext(
  context: any,
  systemMessage: Message,
  messages: Message[],
  requestedResponseTokens: number,
  enableThinking: boolean,
): Promise<{ messages: Message[]; promptTokens: number; responseTokens: number }> {
  // Keep the current user turn and discard only the oldest conversation turns.
  // The exact chat template is model-specific, so count its real tokens instead
  // of estimating from characters.
  let recentMessages = [...messages];

  while (recentMessages.length > 1) {
    const formatted = await context.getFormattedChat(
      [systemMessage, ...recentMessages],
      undefined,
      { enable_thinking: enableThinking },
    );
    const promptTokens = (await context.tokenize(formatted.prompt)).tokens.length;
    const responseTokens = Math.min(
      requestedResponseTokens,
      LOCAL_CONTEXT_TOKENS - promptTokens - LOCAL_CONTEXT_SAFETY_TOKENS,
    );
    if (responseTokens >= LOCAL_MIN_RESPONSE_TOKENS) {
      return { messages: [systemMessage, ...recentMessages], promptTokens, responseTokens };
    }
    const dropsCompleteTurn = recentMessages[0]?.role === 'user'
      && recentMessages[1]?.role === 'assistant';
    recentMessages = recentMessages.slice(dropsCompleteTurn ? 2 : 1);
  }

  const fittedMessages = [systemMessage, ...recentMessages];
  const formatted = await context.getFormattedChat(
    fittedMessages,
    undefined,
    { enable_thinking: enableThinking },
  );
  const promptTokens = (await context.tokenize(formatted.prompt)).tokens.length;
  const responseTokens = Math.min(
    requestedResponseTokens,
    LOCAL_CONTEXT_TOKENS - promptTokens - LOCAL_CONTEXT_SAFETY_TOKENS,
  );
  if (responseTokens < LOCAL_MIN_RESPONSE_TOKENS) {
    throw new Error('Local prompt is too long for the model context.');
  }
  return { messages: fittedMessages, promptTokens, responseTokens };
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
      if ((await getModelStatus(activeId)) !== 'installed') {
        throw new Error('No local model installed. Download one to use local AI.');
      }
      const modelPath = await resolveModelPath(activeId);
      this._status = { state: 'loading', progress: 0.5 };

      const llama = await import('llama.rn');
      llamaContext = await llama.initLlama({
        model: modelPath,
        n_ctx: LOCAL_CONTEXT_TOKENS,
        n_threads: 4,
        n_gpu_layers: 0,
        ctx_shift: true,
      });

      loadedModelId = activeId;
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
    // Qwen3 exposes its chain of thought in some llama.cpp runtimes unless
    // explicitly disabled. Alice keeps the answer-focused mode for every Qwen3.
    const enableThinking = !activeModelId.startsWith('qwen3-');

    const responseLanguage = options?.responseLanguage ?? 'en';
    const systemMessage = { role: 'system' as const, content: buildAliceLocalSystemPrompt(instructions, responseLanguage) };
    const remindedMessages = withAliceInstructionReminder(messages, instructions, responseLanguage, options?.strictLanguageRetry);

    // completion() already receives the complete selected history. Keeping the
    // previous KV cache would duplicate that history and eventually cause a
    // false "Context is full" error on a short conversation.
    await llamaContext.clearCache(false);
    const fitted = await fitMessagesToContext(
      llamaContext,
      systemMessage,
      remindedMessages,
      params.maxTokens,
      enableThinking,
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
