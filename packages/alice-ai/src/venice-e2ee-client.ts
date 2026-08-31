// Venice E2EE transport: attestation, encrypted request, streamed decryption.
//
// `fetch` is injected rather than imported so this module stays loadable outside
// Metro (llm.ts passes expo/fetch). Nothing here reads storage or React state.
//
// Two encryption directions, easy to conflate:
//   request, a fresh ephemeral key per message, encrypted TO the model key
//              from the attestation; that public key rides inside its envelope.
//   response, the TEE encrypts TO the client session key advertised in
//              X-Venice-TEE-Client-Pub-Key, with its own ephemeral per chunk.
// The response session key is therefore intentionally different from every
// request-message key. Its public half goes in the header and its secret half
// decrypts every response chunk.

import {
  VeniceE2EEError,
  assertVeniceCryptoRuntime,
  decryptEnvelope,
  encryptToEnvelope,
  generateAttestationNonce,
  generateEphemeralKeyPair,
  wipeKey,
// Explicit .ts extension: Node resolves ES module specifiers literally, and
// this module has to stay loadable by `node --test` (see README).
} from './venice-e2ee-crypto.ts';
import {
  verifyAttestationChain,
  type AssuranceLevel,
  type ChainPolicy,
} from './venice-attestation-chain.ts';
import { failureDetail } from './venice-failure.ts';
import type { Message } from './llm';

export type FetchLike = (url: string, init?: any) => Promise<any>;

export type VeniceE2EETransport = {
  /** Base URL including the API version, e.g. https://proxy.example.com/api/v1 */
  baseUrl: string;
  /**
   * Only set on surfaces that legitimately hold the Venice key (desktop/mobile
   * direct mode). The public web build must leave this undefined and let the
   * blind proxy attach it, so the key never reaches the browser.
   */
  authorization?: string;
  /** Alice account headers, only when the request goes through Alice's proxy. */
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
};

export type AttestationResult = {
  modelPublicKey: Uint8Array;
  modelPublicKeyHex: string;
  signingAddress?: string;
  assurance: AssuranceLevel;
  tcbStatus: string;
};

/**
 * How conversation history is handled under E2EE.
 *
 * Venice encrypts `user` and `system` messages only, `assistant` messages
 * travel as plaintext. Sending prior Alice replies would therefore leak them to
 * the proxy and to Venice, which is exactly what this mode exists to prevent.
 * 'drop' is the safe default: E2EE turns are single-shot, with no assistant
 * history leaving the device. 'plaintext' is offered for an explicit, informed
 * product decision, never as a silent fallback.
 */
export type AssistantHistoryPolicy = 'drop' | 'plaintext';

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function authHeaders(transport: VeniceE2EETransport): Record<string, string> {
  return {
    ...(transport.authorization ? { Authorization: transport.authorization } : {}),
    ...(transport.headers ?? {}),
  };
}

function requestErrorFromBody(raw: string, status: number, fallback: string): VeniceE2EEError {
  let message = fallback;
  let code: string | undefined;
  try {
    const body = JSON.parse(raw);
    if (typeof body?.error === 'object') {
      code = typeof body.error.code === 'string' ? body.error.code : undefined;
      message = typeof body.error.message === 'string' ? body.error.message : message;
    } else if (typeof body?.error === 'string') {
      message = body.error;
    }
  } catch {}
  return new VeniceE2EEError(message, { status, code });
}

async function requestError(response: any, fallback: string): Promise<VeniceE2EEError> {
  let raw = '';
  try {
    raw = await response.text();
  } catch {}
  return requestErrorFromBody(raw, response.status, fallback);
}

/**
 * Whether an error body is in fact a full attestation in disguise.
 *
 * Venice mirrors its own `verified` flag into the HTTP status: when its
 * server-side check fails (NRAS, NVIDIA's GPU attestation service, has real
 * outages) the complete, otherwise sound attestation still arrives, wrapped
 * in a 502. The check here is only a cheap shape test; the decision of
 * whether to trust it belongs to verifyAttestationChain and nothing else.
 */
function carriesAttestationMaterial(body: any): boolean {
  return !!body && typeof body === 'object' && (
    typeof body.intel_quote === 'string' ||
    typeof body.quote === 'string' ||
    typeof body?.attestation?.evidence?.quote === 'string'
  );
}

function resolveFetch(transport: VeniceE2EETransport): FetchLike {
  const impl = transport.fetchImpl ?? (globalThis as any).fetch;
  if (!impl) throw new VeniceE2EEError('No fetch implementation available.');
  return impl;
}

/**
 * How a failure inside the verification chain reaches the user.
 *
 * Only a service that answered "I am struggling" earns "try again shortly".
 * A request that never completed says so, and everything else is a refusal:
 * for the user's privacy nothing was sent, and repeating it will not help.
 */
const CHAIN_CODE_MAP: Record<string, string> = {
  collateral_unavailable: 'attestation_unavailable',
  collateral_unreachable: 'attestation_blocked',
  collateral_refused: 'attestation_invalid',
  quote_invalid: 'attestation_invalid',
};

/**
 * Fetch the TEE attestation and verify it before trusting any key from it.
 *
 * Venice's JSON `verified` flag is deliberately ignored. The client verifies
 * the quote itself before trusting the encryption key.
 */
export async function fetchAndVerifyAttestation(
  transport: VeniceE2EETransport,
  model: string,
  policy: ChainPolicy,
): Promise<AttestationResult> {
  const nonce = generateAttestationNonce();
  const url = `${normalizeBase(transport.baseUrl)}/tee/attestation?model=${encodeURIComponent(model)}&nonce=${nonce}`;

  let response: any;
  try {
    response = await resolveFetch(transport)(url, {
      method: 'GET',
      headers: { ...authHeaders(transport) },
    });
  } catch (err) {
    // The request never left, or never came back. Not the same thing as the
    // service being busy, and not something waiting will repair.
    throw new VeniceE2EEError('Could not reach the attestation service.', {
      code: 'attestation_blocked',
      detail: failureDetail({ stage: 'attestation', url, error: err }),
    });
  }

  if (!response.ok) {
    let raw = '';
    try {
      raw = await response.text();
    } catch {}

    // Venice's HTTP status echoes its own `verified` flag, which Alice
    // deliberately ignores: she verifies the quote herself. So a 5xx that
    // still carries the attestation material gets judged by our chain, and
    // proceeds if — and only if — that chain accepts it. A missing body, or
    // one our own verification refuses, falls through to the refusal below.
    if (response.status >= 500) {
      let salvaged: any;
      try {
        salvaged = JSON.parse(raw);
      } catch {}
      if (carriesAttestationMaterial(salvaged)) {
        try {
          return await verifyAttestationChain(salvaged, nonce, policy);
        } catch {
          // Our own chain refused it too; the upstream trouble stands.
        }
      }
    }

    const error = requestErrorFromBody(
      raw,
      response.status,
      `Attestation request failed (HTTP ${response.status}).`,
    );
    throw new VeniceE2EEError(error.message, {
      status: error.status,
      code: response.status >= 500 ? 'attestation_unavailable' : 'attestation_invalid',
      detail: failureDetail({ stage: 'attestation', url, status: response.status }),
    });
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new VeniceE2EEError('Attestation response was not valid JSON.', {
      code: 'attestation_invalid',
    });
  }

  try {
    return await verifyAttestationChain(data, nonce, policy);
  } catch (err) {
    if (err instanceof VeniceE2EEError) {
      // Read the code the DCAP layer set, rather than matching on its wording.
      // The previous test was a string prefix, so any rephrasing downstream
      // silently turned a blocked request into "verification failed".
      throw new VeniceE2EEError(err.message, {
        status: err.status,
        code: CHAIN_CODE_MAP[err.code ?? ''] ?? 'attestation_invalid',
        detail: err.detail,
      });
    }
    throw err;
  }
}

/**
 * Build the request message list. Encrypts every user/system message, Venice
 * rejects the request outright if any of them is left in the clear while the
 * E2EE headers are present.
 */
export function buildEncryptedMessages(
  messages: Message[],
  modelPublicKey: Uint8Array,
  assistantHistory: AssistantHistoryPolicy,
): { role: Message['role']; content: string }[] {
  // Venice currently rejects E2EE requests containing more than one `system`
  // message, returning the misleading error "E2EE decryption failed". Alice
  // legitimately has several system fragments (base policy, transient RAG,
  // pedagogy and output-language reminder), so preserve their order while
  // combining them into the single leading system envelope Venice accepts.
  const systemContent = messages
    .filter(message => message.role === 'system')
    .map(message => message.content)
    .filter(Boolean)
    .join('\n\n');
  const normalized: Message[] = [
    ...(systemContent ? [{ role: 'system' as const, content: systemContent }] : []),
    ...messages.filter(message => message.role !== 'system'),
  ];
  const out: { role: Message['role']; content: string }[] = [];
  for (const message of normalized) {
    if (message.role === 'assistant') {
      if (assistantHistory === 'drop') continue;
      // Plaintext by protocol: Venice does not decrypt assistant turns.
      out.push({ role: 'assistant', content: message.content });
      continue;
    }
    out.push({ role: message.role, content: encryptToEnvelope(modelPublicKey, message.content) });
  }
  return out;
}

export type E2EEStreamResult = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  truncated: boolean;
  assurance: AssuranceLevel;
  timings: Record<string, number>;
};

export type E2EERequestOptions = {
  transport: VeniceE2EETransport;
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  assistantHistory?: AssistantHistoryPolicy;
  attestationPolicy: ChainPolicy;
};

/**
 * Run one E2EE chat completion. Always streams, Venice rejects
 * `stream: false` on E2EE models, and there is deliberately no non-streaming
 * branch here to fall back to.
 */
export async function streamE2EEChatCompletion(
  options: E2EERequestOptions,
  onChunk?: (chunk: string) => void,
): Promise<E2EEStreamResult> {
  const { transport, model, messages } = options;
  assertVeniceCryptoRuntime();
  const assistantHistory = options.assistantHistory ?? 'drop';
  // A new nonce and quote are fetched for every call. Only public collateral
  // may be cached by the DCAP adapter.
  const attestationStarted = Date.now();
  const attestation = await fetchAndVerifyAttestation(
    transport,
    model,
    options.attestationPolicy,
  );
  const attestationMs = Date.now() - attestationStarted;
  const session = generateEphemeralKeyPair();

  try {
    const encryptionStarted = Date.now();
    const payload = {
      model,
      messages: buildEncryptedMessages(messages, attestation.modelPublicKey, assistantHistory),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1024,
      // Never configurable: E2EE is streaming-only.
      stream: true,
      stream_options: { include_usage: true },
    };
    const requestBody = JSON.stringify(payload);
    const requestEncryptionMs = Date.now() - encryptionStarted;

    let response: any;
    const upstreamStarted = Date.now();
    try {
      response = await resolveFetch(transport)(
        `${normalizeBase(transport.baseUrl)}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders(transport),
            'X-Venice-TEE-Client-Pub-Key': session.publicKeyHex,
            'X-Venice-TEE-Model-Pub-Key': attestation.modelPublicKeyHex,
            'X-Venice-TEE-Signing-Algo': 'ecdsa',
          },
          body: requestBody,
        },
      );
    } catch (err) {
      throw new VeniceE2EEError(
        `Encrypted request failed: ${err instanceof Error ? err.message : 'network error'}`,
      );
    }

    if (!response.ok) {
      throw await requestError(
        response,
        `Encrypted request rejected (HTTP ${response.status}).`,
      );
    }
    if (!response.body) {
      throw new VeniceE2EEError('Encrypted response carried no stream.');
    }

    const upstreamWaitMs = Date.now() - upstreamStarted;
    const result = await readEncryptedStream(response.body, session.secretKey, onChunk);
    return {
      ...result,
      assurance: attestation.assurance,
      timings: {
        attestationMs,
        requestEncryptionMs,
        upstreamWaitMs,
        ...result.timings,
      },
    };
  } finally {
    wipeKey(session.secretKey);
  }
}

/**
 * Decode the SSE stream, decrypting each chunk. Every `delta.content` is a
 * complete envelope; a chunk that is not decryptable aborts the whole response
 * rather than being shown, so a downgrade to plaintext can never reach the UI.
 */
export async function readEncryptedStream(
  body: any,
  clientSecretKey: Uint8Array,
  onChunk?: (chunk: string) => void,
): Promise<Omit<E2EEStreamResult, 'assurance'>> {
  const streamStarted = Date.now();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  let usage: E2EEStreamResult['usage'];
  let truncated = false;
  let responseDecryptionMs = 0;
  let encryptedChunks = 0;

  const handleLine = (line: string) => {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith('data: ')) return;
    const json = trimmed.slice(6).trim();
    if (!json || json === '[DONE]') return;

    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      // Malformed SSE frame: ignore, as the plain path does.
      return;
    }

    // Protocol-only frames that legitimately travel in the clear: token usage
    // and the finish reason. These carry no model output.
    if (parsed.usage) {
      const u = parsed.usage;
      usage = {
        promptTokens: u.prompt_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
      };
    }
    if (parsed.choices?.[0]?.finish_reason === 'length') truncated = true;

    // Anything under delta.content is user-visible model output and MUST be
    // encrypted. It is never shown just because it looks like text.
    const delta = parsed.choices?.[0]?.delta ?? {};
    if (!('content' in delta) || delta.content == null || delta.content === '') return;
    const encrypted = delta.content;
    if (typeof encrypted !== 'string') {
      throw new VeniceE2EEError('Response chunk content was not an encrypted string.');
    }

    // Fail closed: decryptEnvelope authenticates (AES-GCM) and throws on any
    // failure, a plaintext chunk, a short/non-hex value, a bad tag, or a chunk
    // encrypted to a different session. The throw aborts the whole stream, so no
    // unauthenticated content is ever emitted.
    const decryptionStarted = Date.now();
    const piece = decryptEnvelope(clientSecretKey, encrypted);
    responseDecryptionMs += Date.now() - decryptionStarted;
    encryptedChunks += 1;
    if (piece) {
      full += piece;
      onChunk?.(piece);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer) handleLine(buffer);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }

  return {
    content: full,
    usage,
    truncated,
    timings: {
      responseStreamMs: Date.now() - streamStarted,
      responseDecryptionMs,
      encryptedChunks,
    },
  };
}
