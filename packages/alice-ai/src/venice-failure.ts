// Why a Private Cloud verification step did not complete, said precisely.
//
// Three failures used to arrive as one sentence: "temporarily unavailable".
// A server having a bad minute, a request that never left the device, and a
// response the client could not read are three different problems with three
// different remedies, and telling the user to "try again shortly" for the last
// two is simply false: they will still be there tomorrow.
//
// This module is the classifier, kept pure so the vocabulary it produces is
// testable without a network. It answers two questions:
//   - what kind of failure was it, which decides what the user is told;
//   - what is the one technical line worth showing them, which decides
//     whether a bug report can be acted on.
//
// The detail line carries a closed vocabulary only: stage, host, HTTP status,
// error class, and a classified hint. Never a server message, never a URL with
// a query string, never anything derived from a prompt, a response or a key.
// The same rule as the Satora diagnostics, for the same reason: free text from
// elsewhere has no place on a user's screen or in a log we publish.

export type FailureKind =
  /** The request never completed: offline, blocked, or refused by CORS. */
  | 'unreachable'
  /** It completed, and the other side said it is having trouble right now. */
  | 'unavailable'
  /** It completed, and the answer could not be used. Waiting will not help. */
  | 'refused';

export type FailureStage = 'attestation' | 'collateral' | 'verify';

/** Trailing HTTP status in a thrown message, e.g. "Failed to fetch TCB info: 503". */
const TRAILING_STATUS = /(?:^|[\s:])([1-5]\d{2})\.?$/;

function errorName(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return 'unknown';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : '';
}

/** The HTTP status a thrown error was really about, when it named one. */
export function statusFromError(err: unknown): number | undefined {
  const match = TRAILING_STATUS.exec(messageOf(err).trim());
  if (!match) return undefined;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : undefined;
}

/**
 * What kind of failure this is.
 *
 * A `TypeError` from `fetch` means the request did not complete at all: the
 * device is offline, a content policy blocked it, or CORS refused it. That is
 * never a "try again shortly", and on a packaged app it is usually our own
 * configuration rather than the user's network.
 */
export function classifyFailure(err: unknown): FailureKind {
  if (errorName(err) === 'TypeError') return 'unreachable';
  const status = statusFromError(err);
  if (status !== undefined) return status >= 500 ? 'unavailable' : 'refused';
  return 'refused';
}

/**
 * A short hint naming the shape of the failure, when it is recognisable.
 *
 * `headers` is worth its own word: the collateral library reads Intel issuer
 * chains out of response headers, and a browser only sees headers a server
 * chose to expose. A missing one looks like a network fault and is not.
 */
export function hintFor(err: unknown): string | undefined {
  const message = messageOf(err);
  if (/^Missing /i.test(message)) return 'headers';
  if (/JSON|unexpected token/i.test(message)) return 'parse';
  if (/not defined/i.test(message)) return 'runtime';
  if (errorName(err) === 'TypeError') return 'blocked-or-offline';
  return undefined;
}

/** The host of a URL, or nothing. Never the path or the query. */
export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * The one line a user can copy into a bug report, and the only place a
 * technical cause is allowed to reach a screen.
 */
export function failureDetail(parts: {
  stage: FailureStage;
  url?: string;
  status?: number;
  error?: unknown;
}): string {
  const fields: string[] = [`stage=${parts.stage}`];
  const host = hostOf(parts.url);
  if (host) fields.push(`host=${host}`);

  const status = parts.status ?? statusFromError(parts.error);
  if (status !== undefined) fields.push(`status=${status}`);

  if (parts.error !== undefined) {
    fields.push(`kind=${classifyFailure(parts.error)}`);
    fields.push(`error=${errorName(parts.error)}`);
    const hint = hintFor(parts.error);
    if (hint) fields.push(`hint=${hint}`);
  }
  return fields.join(' ');
}
