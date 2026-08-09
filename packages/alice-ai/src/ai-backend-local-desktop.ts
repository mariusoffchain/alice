import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AIBackend, AIBackendStatus, AIResponse, SendMessageOptions, TokenUsage } from './ai-backend';
import type { Message } from './llm';
import { tauriInvoke } from './tauri-runtime';
import {
  getPreset,
  PRESETS,
  getAliceInstructions,
  getActiveModelId,
  getModelEntry,
  MODEL_CATALOG,
  type LocalModelId,
  type ModelStatus,
} from './ai-preferences';
import {
  applyAliceResponseConstraints,
  buildAliceSystemPrompt,
  requiresBufferedAliceResponse,
  withAliceInstructionReminder,
} from './ai-system-prompt';
import { fitMessagesToEstimatedLocalContext } from './local-context-budget';

const LLAMA_BASE = 'http://localhost:11435';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

const DESKTOP_MODEL_PATH_KEY = 'alice_ai_desktop_model_path';

export async function getDesktopModelPath(): Promise<string | null> {
  return AsyncStorage.getItem(DESKTOP_MODEL_PATH_KEY);
}

export async function setDesktopModelPath(path: string): Promise<void> {
  await AsyncStorage.setItem(DESKTOP_MODEL_PATH_KEY, path);
}

function entryFor(id: LocalModelId) {
  return getModelEntry(id);
}

export async function getDesktopModelStatus(id: LocalModelId): Promise<ModelStatus> {
  const entry = entryFor(id);
  const status = await tauriInvoke<ModelStatus>('local_ai_model_status', {
    filename: entry.filename,
  });
  return status === 'installed' ? 'installed' : 'not-installed';
}

export async function getDesktopInstalledModelPath(id: LocalModelId): Promise<string | null> {
  const entry = entryFor(id);
  try {
    return await tauriInvoke<string>('local_ai_model_path', {
      filename: entry.filename,
    });
  } catch {
    return null;
  }
}

export async function installDesktopModel(
  id: LocalModelId,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const entry = entryFor(id);
  await tauriInvoke('local_ai_download_model_prepare', { filename: entry.filename });
  try {
    const response = await globalThis.fetch(entry.url);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status})`);
    }
    const total = Number(response.headers.get('content-length') ?? entry.sizeBytes);
    const reader = response.body.getReader();
    let written = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      written += value.byteLength;
      await tauriInvoke('local_ai_download_model_chunk', {
        filename: entry.filename,
        chunk: Array.from(value),
      });
      if (total > 0) onProgress?.(Math.min(written / total, 1));
    }
    await tauriInvoke('local_ai_download_model_finish', { filename: entry.filename });
    onProgress?.(1);
  } catch (error) {
    await tauriInvoke('local_ai_delete_model', { filename: entry.filename }).catch(() => {});
    throw error;
  }
}

export async function deleteDesktopModel(id: LocalModelId): Promise<void> {
  const entry = entryFor(id);
  await tauriInvoke('local_ai_delete_model', {
    filename: entry.filename,
  });
}

export async function deleteAllDesktopModels(): Promise<void> {
  for (const model of MODEL_CATALOG) {
    await deleteDesktopModel(model.id);
  }
}

async function pollUntilReady(): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await globalThis.fetch(`${LLAMA_BASE}/v1/models`);
      if (res.ok) return;
    } catch {}
    await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('llama-server did not become ready within 30 s.');
}

async function isLocalServerReady(): Promise<boolean> {
  try {
    const res = await globalThis.fetch(`${LLAMA_BASE}/v1/models`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForExistingLocalServer(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLocalServerReady()) return true;
    await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

export class LocalDesktopAIBackend implements AIBackend {
  readonly type = 'local' as const;
  private _status: AIBackendStatus = { state: 'idle' };

  async init(): Promise<void> {
    this._status = { state: 'loading' };
    try {
      if (await isLocalServerReady()) {
        this._status = { state: 'ready' };
        return;
      }
      const activeModelId = await getActiveModelId();
      const installedModelPath = await getDesktopInstalledModelPath(activeModelId);
      const modelPath = await getDesktopModelPath();
      const selectedModelPath = installedModelPath || modelPath;
      if (selectedModelPath) {
        await tauriInvoke('local_ai_start', { modelPath: selectedModelPath });
        await pollUntilReady();
        this._status = { state: 'ready' };
        return;
      }
      // Nothing is installed. Waiting fifteen seconds for a server that was
      // never started only delays the same answer, so say it straight away and
      // name the action that actually fixes it. No model ships with Alice: on
      // a fresh install this is the expected state, not a failure.
      if (await waitForExistingLocalServer(1_000)) {
        this._status = { state: 'ready' };
        return;
      }
      this._status = {
        state: 'error',
        message: 'No local model is installed yet. Download one from Settings, '
          + 'or keep using Private Cloud.',
      };
    } catch (e) {
      this._status = { state: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  status(): AIBackendStatus {
    return this._status;
  }

  async sendMessage(messages: Message[], onChunk?: (chunk: string) => void, options?: SendMessageOptions): Promise<AIResponse> {
    if (this._status.state !== 'ready') throw new Error('Local AI is not ready.');

    const [preset, instructions] = await Promise.all([getPreset('local'), getAliceInstructions()]);
    const params = PRESETS[preset];
    const shouldBuffer = requiresBufferedAliceResponse(instructions);
    const streamFn = shouldBuffer ? undefined : onChunk;

    const fullMessages = [
      { role: 'system' as const, content: buildAliceSystemPrompt(instructions, options?.responseLanguage ?? 'en') },
      ...withAliceInstructionReminder(messages, instructions, options?.responseLanguage ?? 'en', options?.strictLanguageRetry),
    ];

    const fitted = fitMessagesToEstimatedLocalContext(fullMessages, params.maxTokens);
    const streaming = Boolean(streamFn);
    const payload: Record<string, unknown> = {
      model: 'local',
      messages: fitted.messages,
      temperature: options?.temperatureOverride ?? params.temperature,
      max_tokens: fitted.responseTokens,
      stream: streaming,
    };
    if (streaming) payload.stream_options = { include_usage: true };

    const t0 = Date.now();
    const response = await globalThis.fetch(`${LLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`llama-server error ${response.status}`);

    let result: string;
    let usage: TokenUsage | undefined;
    let truncated = false;

    if (streamFn && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (!trimmed.startsWith('data: ')) continue;
          const json = trimmed.slice(6).trim();
          if (!json || json === '[DONE]') continue;
          try {
            const parsed = JSON.parse(json);
            if (parsed.usage) {
              const u = parsed.usage;
              usage = {
                promptTokens: u.prompt_tokens ?? 0,
                completionTokens: u.completion_tokens ?? 0,
                totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
              };
            }
            // llama-server speaks the OpenAI shape: finish_reason 'length' means
            // it stopped at max_tokens rather than finishing.
            if (parsed.choices?.[0]?.finish_reason === 'length') truncated = true;
            const delta = parsed.choices?.[0]?.delta?.content ?? '';
            if (delta) { full += delta; streamFn(delta); }
          } catch {}
        }
      }
      result = full;
    } else {
      const data = await response.json() as Record<string, unknown>;
      const choices = data.choices as { message?: { content?: string }; finish_reason?: string }[] | undefined;
      result = choices?.[0]?.message?.content ?? '';
      truncated = choices?.[0]?.finish_reason === 'length';
      const u = data.usage as Record<string, number> | undefined;
      if (u) {
        usage = {
          promptTokens: u.prompt_tokens ?? 0,
          completionTokens: u.completion_tokens ?? 0,
          totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
        };
      }
    }

    const constrained = applyAliceResponseConstraints(instructions, result);
    if (shouldBuffer && onChunk) onChunk(constrained);
    return { content: constrained, usage, durationMs: Date.now() - t0, truncated };
  }

  async dispose(): Promise<void> {
    this._status = { state: 'idle' };
    await tauriInvoke('local_ai_stop').catch(() => {});
  }
}
