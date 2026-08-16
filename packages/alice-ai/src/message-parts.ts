// Foundation for everything Alice can be handed: today text and dé-identified
// analysis signals, later images, audio and documents. A message content is a
// list of typed parts instead of a bare string, so a new format is a new
// variant rather than a new function parameter.
//
// Nothing here reaches a model on its own. `partsToText` is the single place
// that turns parts into the wire text a language model consumes, so what the UI
// shows on a part and what the backend sends can never drift apart.
//
// This module is intentionally pure: no React, no storage, no network. It can
// be unit-tested in isolation and imported from any surface (web, native,
// desktop) without pulling a runtime.

/** What a part carries. Formats past `text`/`signal` are declared now and wired later. */
export type PartKind = 'text' | 'signal' | 'image' | 'audio' | 'document' | 'file';

/**
 * How sensitive a part is, from the routing engine's point of view. The order
 * matters: `messagePrivacy` takes the strongest level across a message.
 *
 * - `public`     a general question, a knowledge-base reference: nothing to hide.
 * - `abstracted` an AbstractSignal: dé-identified by construction, cloud-eligible.
 * - `identifying`a raw address/txid/xpub, a wallet screenshot, a voice clip:
 *                forces local-only, never the cloud.
 * - `forbidden`  a seed or private key: blocked at input, never sent anywhere.
 */
export type PartPrivacy = 'public' | 'abstracted' | 'identifying' | 'forbidden';

const PRIVACY_RANK: Record<PartPrivacy, number> = {
  public: 0,
  abstracted: 1,
  identifying: 2,
  forbidden: 3,
};

/** Interface-side metadata every part carries, independent of its payload. */
export type MessagePartMeta = {
  /** Stable id of the attachment chip in the UI. */
  id: string;
  privacy: PartPrivacy;
  /** What the user reads on the chip. */
  label: string;
};

// The AbstractSignal type lives with the Privacy Lab engine and is not built
// yet. Kept as `unknown` here so this foundation carries no dependency on the
// engine; the signal part is typed precisely once `audit-core` exists.
type AbstractSignalPlaceholder = unknown;

/**
 * Binary payloads travel as bytes or as a base64/data-url string depending on
 * the surface. Declared now; no capture path is wired until a model can read them.
 */
export type BinaryData = Uint8Array | string;

export type MessagePart =
  | ({ kind: 'text'; text: string } & MessagePartMeta)
  | ({ kind: 'signal'; signal: AbstractSignalPlaceholder } & MessagePartMeta)
  | ({ kind: 'image'; mime: string; data: BinaryData; alt?: string } & MessagePartMeta)
  | ({ kind: 'audio'; mime: string; data: BinaryData; durationMs?: number } & MessagePartMeta)
  | ({ kind: 'document'; mime: string; data: BinaryData; filename?: string } & MessagePartMeta)
  | ({ kind: 'file'; mime: string; data: BinaryData; filename?: string } & MessagePartMeta);

/**
 * A message's content: either a bare string (every existing caller, unchanged)
 * or a list of typed parts. Keeping the string arm is what makes the whole
 * change additive.
 */
export type MessageContent = string | MessagePart[];

/** Type guard: has this content been upgraded to parts, or is it still a string? */
export function isPartsContent(content: MessageContent): content is MessagePart[] {
  return Array.isArray(content);
}

/**
 * The privacy level of a whole message is the strongest level among its parts.
 * A single identifying part pins the entire message to local-only. A bare
 * string carries no attachment, so it is treated as `public` on its own; the
 * caller still runs its own raw-identifier detection on the typed text before
 * deciding a route (a pasted address in the prose is not this function's job).
 */
export function messagePrivacy(content: MessageContent): PartPrivacy {
  if (!isPartsContent(content)) return 'public';
  let strongest: PartPrivacy = 'public';
  for (const part of content) {
    if (PRIVACY_RANK[part.privacy] > PRIVACY_RANK[strongest]) strongest = part.privacy;
  }
  return strongest;
}

/**
 * Turn a content value into the plain text a language model consumes. This is
 * the ONLY place parts become text, so a part rendered in the UI and the text
 * sent to the model derive from the same object.
 *
 * `renderSignal` is injected by the caller that owns the AbstractSignal type, so
 * this foundation stays free of the engine. Until it is provided, a signal part
 * renders as an explicit placeholder rather than leaking `[object Object]`.
 */
export type PartsToTextOptions = {
  renderSignal?: (signal: AbstractSignalPlaceholder) => string;
  /** How an unsupported binary part is announced when it cannot be read. */
  renderUnsupported?: (part: MessagePart) => string;
};

export function partsToText(content: MessageContent, options: PartsToTextOptions = {}): string {
  if (!isPartsContent(content)) return content;

  const renderUnsupported =
    options.renderUnsupported ??
    ((part: MessagePart) => `[${part.kind} attachment: ${part.label}]`);

  const pieces: string[] = [];
  for (const part of content) {
    switch (part.kind) {
      case 'text':
        pieces.push(part.text);
        break;
      case 'signal':
        pieces.push(options.renderSignal ? options.renderSignal(part.signal) : `[signal: ${part.label}]`);
        break;
      default:
        pieces.push(renderUnsupported(part));
        break;
    }
  }
  return pieces.join('\n\n');
}

/**
 * A message as it crosses the send boundary: its content may be a bare string
 * (every existing caller) or a list of parts (the Inspector, later). Kept
 * structural so this module imports nothing from the LLM layer and stays a leaf.
 */
export type PartMessage = {
  role: 'user' | 'assistant' | 'system';
  content: MessageContent;
};

/** A message once flattened for a language model: content is always a string. */
export type WireMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

/**
 * Flatten a list of boundary messages into wire messages a model consumes.
 * This is the funnel a backend calls before talking to its model: after it,
 * everything downstream sees plain string content, exactly as today. For a
 * message whose content is already a string, it is an identity pass.
 */
export function normalizeMessages(
  messages: readonly PartMessage[],
  options?: PartsToTextOptions,
): WireMessage[] {
  return messages.map(m => ({ role: m.role, content: partsToText(m.content, options) }));
}

/** Convenience for building a plain text part, the common case. */
export function textPart(text: string, meta?: Partial<MessagePartMeta>): MessagePart {
  return {
    kind: 'text',
    text,
    id: meta?.id ?? '',
    privacy: meta?.privacy ?? 'public',
    label: meta?.label ?? 'text',
  };
}
