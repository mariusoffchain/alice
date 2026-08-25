import { fetch } from 'expo/fetch';
import { BITCOIN_SYSTEM_PROMPT } from '@alice-wallet/alice-content';
import type { AIResponse, TokenUsage } from './ai-backend';
import { VeniceAPIError, classifyVeniceError, parseVeniceErrorText } from './venice-errors';
import { streamE2EEChatCompletion } from './venice-e2ee-client.ts';
import { VeniceE2EEError } from './venice-e2ee-crypto.ts';
import { EMPTY_MEASUREMENT_POLICY } from './venice-measurement-policy.ts';
import { isE2EEModel, resolveVeniceTransport, VeniceTransportError } from './venice-transport.ts';
import {
  AliceAccountError,
  privateCloudAccountHeaders,
} from './account-client';

export { VeniceAPIError, type VeniceErrorCode } from './venice-errors';

// Venice Private Cloud, OpenAI-compatible chat completions endpoint.
const VENICE_API_URL = 'https://api.venice.ai/api/v1/chat/completions';
const VENICE_MODEL = 'e2ee-gpt-oss-120b-p';

// Set via app config / env, never hardcode in production.
// WARNING: anything prefixed EXPO_PUBLIC_ is inlined into the client bundle.
// An APK and desktop binary are inspectable too, so distributed Alice builds
// must use the proxy below. A direct key is limited to explicit internal
// diagnostics with a personal, revocable key.
const VENICE_API_KEY = process.env.EXPO_PUBLIC_VENICE_API_KEY ?? '';

// Alice's blind proxy. Not a secret, it is only a URL, but when it is set it
// takes precedence, and the key is never sent from the client.
const VENICE_PROXY_URL = process.env.EXPO_PUBLIC_VENICE_PROXY_URL ?? '';
const VENICE_PCCS_URL = process.env.EXPO_PUBLIC_VENICE_PCCS_URL ?? '';
const ALLOW_DIRECT_VENICE = process.env.EXPO_PUBLIC_ALLOW_DIRECT_VENICE === 'true';

function resolvePccsUrl(
  transport: { baseUrl: string; viaProxy: boolean },
  defaultPccsUrl: string,
): string {
  if (VENICE_PCCS_URL.trim()) return VENICE_PCCS_URL.trim().replace(/\/+$/, '');
  if (transport.viaProxy) {
    const root = transport.baseUrl.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
    return `${root}/pccs`;
  }
  return defaultPccsUrl;
}

// Inlined rather than imported from ai-backend-factory, which imports the
// backends, which import this module: taking that dependency would close a
// cycle. Kept in sync with isTauriDesktop() there.
function isPublicWebBuild(): boolean {
  if (typeof window === 'undefined') return false;
  if ('__TAURI_INTERNALS__' in window) return false;
  return true;
}

export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type InferenceParams = {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  systemPrompt?: string;
  requestId?: string;
};

function parseUsage(data: Record<string, unknown>): TokenUsage | undefined {
  const u = data.usage as Record<string, number> | undefined;
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
  };
}

/** True when Private Cloud will run the encrypted protocol for this model. */
export function usesE2EE(model?: string): boolean {
  return isE2EEModel(model ?? VENICE_MODEL);
}

/**
 * Encrypted path. Selecting an `e2ee-*` model commits to it: there is no
 * plaintext fallback here, by design. If attestation or decryption fails the
 * call throws and the user sees an error, rather than an answer that quietly
 * travelled in the clear.
 */
async function sendE2EEMessage(
  messages: Message[],
  onChunk: ((chunk: string) => void) | undefined,
  params: InferenceParams | undefined,
  model: string,
): Promise<AIResponse> {
  if (!VENICE_PROXY_URL.trim() && !ALLOW_DIRECT_VENICE) {
    throw new VeniceAPIError(
      'missing_api_key',
      'Private Cloud requires the Alice account service in this build.',
    );
  }
  let transport;
  try {
    transport = resolveVeniceTransport({
      proxyUrl: VENICE_PROXY_URL,
      apiKey: VENICE_API_KEY,
      isPublicWeb: isPublicWebBuild(),
    });
  } catch (err) {
    if (err instanceof VeniceTransportError) {
      throw new VeniceAPIError('missing_api_key', err.message);
    }
    throw err;
  }

  const t0 = Date.now();
  try {
    let accountHeaders: Record<string, string> | undefined;
    if (transport.viaProxy) {
      try {
        accountHeaders = await privateCloudAccountHeaders(params?.requestId);
      } catch (err) {
        if (err instanceof AliceAccountError) {
          throw new VeniceAPIError(
            err.code === 'account_required' || err.code === 'session_expired'
              ? 'account_required'
              : 'api_error',
            err.message,
            err.status,
          );
        }
        throw err;
      }
    }
    // DCAP is sizeable and only needed by Private. Lazy-loading keeps Local and
    // Custom startup lean without weakening the pre-send verification gate.
    const { phalaDcapOptions, DEFAULT_PCCS_URL } = await import('./venice-dcap-phala.ts');
    const result = await streamE2EEChatCompletion(
      {
        transport: {
          baseUrl: transport.baseUrl,
          authorization: transport.authorization,
          headers: accountHeaders,
          fetchImpl: fetch as any,
        },
        model,
        messages: [
          { role: 'system', content: params?.systemPrompt ?? BITCOIN_SYSTEM_PROMPT },
          ...messages,
        ],
        temperature: params?.temperature ?? 0.7,
        maxTokens: params?.maxTokens ?? 400,
        attestationPolicy: {
          dcap: phalaDcapOptions(resolvePccsUrl(transport, DEFAULT_PCCS_URL)),
          measurements: EMPTY_MEASUREMENT_POLICY,
          requireMeasurementPinning: false,
          requireNvidia: false,
        },
      },
      onChunk,
    );
    return {
      content: result.content,
      usage: result.usage,
      durationMs: Date.now() - t0,
      truncated: result.truncated,
      privacyAssurance: result.assurance,
      backendTimings: result.timings,
    };
  } catch (err) {
    if (err instanceof VeniceAPIError) throw err;
    if (err instanceof VeniceE2EEError) {
      if (err.code === 'account_required' || err.code === 'session_expired') {
        throw new VeniceAPIError('account_required', err.message, err.status);
      }
      if (err.code === 'free_quota_exhausted') {
        throw new VeniceAPIError('free_quota_exhausted', err.message, err.status);
      }
      if (err.code === 'plan_quota_exhausted') {
        throw new VeniceAPIError('plan_quota_exhausted', err.message, err.status);
      }
      // `model_not_in_free_plan` is the name the proxy used before plans
      // existed. Both are honoured: a shipped client must keep understanding a
      // deployed Worker, and a deployed client a shipped Worker.
      if (err.code === 'model_not_in_plan' || err.code === 'model_not_in_free_plan') {
        throw new VeniceAPIError('plan_restricted', err.message, err.status);
      }
      if (err.code === 'attestation_unavailable') {
        throw new VeniceAPIError('attestation_unavailable', err.message, err.status);
      }
      if (err.code === 'attestation_invalid') {
        throw new VeniceAPIError('attestation_invalid', err.message, err.status);
      }
      // Surfaced as a normal provider error so the chat UI can render it, but
      // never downgraded into a plaintext retry.
      throw new VeniceAPIError('api_error', err.message);
    }
    throw err;
  }
}

export async function sendMessage(
  messages: Message[],
  onChunk?: (chunk: string) => void,
  params?: InferenceParams,
): Promise<AIResponse> {
  const model = params?.model ?? VENICE_MODEL;

  if (isE2EEModel(model)) {
    return sendE2EEMessage(messages, onChunk, params, model);
  }

  // Plaintext path, for non-`e2ee-*` models only. A public web build must not
  // carry the key at all, encrypted or not.
  if (isPublicWebBuild() && !VENICE_PROXY_URL) {
    throw new VeniceAPIError(
      'missing_api_key',
      'Private Cloud is not available in this web build: no proxy is configured.',
    );
  }
  if (!VENICE_API_KEY) {
    throw new VeniceAPIError(
      'missing_api_key',
      'Private Cloud is not configured yet. Add a Venice API key to use cloud answers.',
    );
  }

  const streaming = Boolean(onChunk);
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: params?.systemPrompt ?? BITCOIN_SYSTEM_PROMPT },
      ...messages,
    ],
    temperature: params?.temperature ?? 0.7,
    max_tokens: params?.maxTokens ?? 400,
    stream: streaming,
  };
  if (streaming) payload.stream_options = { include_usage: true };

  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(VENICE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VENICE_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new VeniceAPIError(
      'network',
      err instanceof Error && err.message ? err.message : 'Network request failed.',
    );
  }

  if (!response.ok) {
    const err = parseVeniceErrorText(await response.text());
    throw new VeniceAPIError(classifyVeniceError(response.status, err), err, response.status);
  }

  if (onChunk && response.body) {
    return streamResponse(response.body, onChunk, t0);
  }

  const data = await response.json();
  return {
    content: data.choices[0].message.content as string,
    usage: parseUsage(data),
    durationMs: Date.now() - t0,
    // 'length' means the provider hit max_tokens and cut mid-sentence, as
    // opposed to 'stop' where the model ended on its own.
    truncated: data.choices[0].finish_reason === 'length',
  };
}

async function streamResponse(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
  t0: number,
): Promise<AIResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  let usage: TokenUsage | undefined;
  let truncated = false;

  function processLine(line: string) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('data: ')) return;

    const json = trimmed.slice(6).trim();
    if (!json || json === '[DONE]') return;

    try {
      const parsed = JSON.parse(json);
      if (parsed.usage) usage = parseUsage(parsed);
      // The final SSE chunk carries finish_reason; 'length' means max_tokens cut it off.
      if (parsed.choices?.[0]?.finish_reason === 'length') truncated = true;
      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        full += delta;
        onChunk(delta);
      }
    } catch {
      // Ignore malformed SSE lines; incomplete lines are buffered before this point.
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer) processLine(buffer);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      processLine(line);
    }
  }

  return { content: full, usage, durationMs: Date.now() - t0, truncated };
}
