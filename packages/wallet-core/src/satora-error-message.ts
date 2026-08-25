type SatoraLimit = 'minimum' | 'maximum';

function limitLabel(limit: SatoraLimit): string {
  return limit === 'minimum' ? 'AMOUNT TOO SMALL' : 'AMOUNT TOO HIGH';
}

function formatLimit(limit: SatoraLimit, sats: number): string {
  return `${limitLabel(limit)}. SATORA ${limit.toUpperCase()}: ${sats.toLocaleString('en-US')} SATS.`;
}

function validSats(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function friendlySatoraLimitError(raw: string): string | null {
  const bitcoinMatch = raw.match(
    /\b(min(?:imum)?|max(?:imum)?)\s+amount\s+is\s+₿\s*([0-9][0-9.\s]*)/i,
  );
  if (bitcoinMatch) {
    const btc = Number(bitcoinMatch[2].replace(/\s/g, ''));
    const sats = validSats(Math.round(btc * 100_000_000));
    if (sats) {
      const limit = bitcoinMatch[1].toLowerCase().startsWith('min')
        ? 'minimum'
        : 'maximum';
      return formatLimit(limit, sats);
    }
  }

  const satsMatch = raw.match(
    /\b(min(?:imum)?|max(?:imum)?|at least)\b[^\d]*([\d,]+)\s*sats?\b/i,
  );
  if (satsMatch) {
    const sats = validSats(Number(satsMatch[2].replace(/,/g, '')));
    if (sats) {
      const limit = satsMatch[1].toLowerCase().startsWith('max')
        ? 'maximum'
        : 'minimum';
      return formatLimit(limit, sats);
    }
  }

  return null;
}

/**
 * The Satora refusals we recognise, turned into a sentence of our own. Any
 * other reason is kept out of the screen: a server message may carry an
 * internal URL, a payload fragment or a stack line, which is for the
 * diagnostic log, not for the user. `null` means "not a known reason".
 */
export function friendlySatoraReason(reason: string): string | null {
  switch (classifySatoraReason(reason)) {
    case 'network':
      return 'SATORA IS UNREACHABLE. CHECK YOUR CONNECTION AND TRY AGAIN. NO FUNDS WERE SENT.';
    case 'invoice_lifetime':
      return 'SATORA ONLY PAYS LIGHTNING INVOICES THAT EXPIRE WITHIN 24 HOURS. ASK THE RECIPIENT FOR A SHORTER INVOICE. NO FUNDS WERE SENT.';
    case 'duplicate_swap':
      return 'THIS INVOICE ALREADY HAS A SATORA SWAP. AN INVOICE ISSUED BY SATORA CANNOT BE PAID THROUGH SATORA. NO FUNDS WERE SENT.';
    case 'invoice_expired':
      return 'THIS LIGHTNING INVOICE HAS EXPIRED. ASK THE RECIPIENT FOR A NEW ONE. NO FUNDS WERE SENT.';
    case 'invoice_paid':
      return 'THIS LIGHTNING INVOICE HAS ALREADY BEEN PAID. NO FUNDS WERE SENT.';
    case 'no_route':
      return 'SATORA FOUND NO LIGHTNING ROUTE TO THIS INVOICE. TRY AGAIN LATER OR WITH ANOTHER INVOICE. NO FUNDS WERE SENT.';
    case 'invalid_invoice':
      return 'SATORA COULD NOT READ THIS LIGHTNING INVOICE. CHECK IT AND TRY AGAIN. NO FUNDS WERE SENT.';
    case 'amountless_invoice':
      return 'SATORA NEEDS AN INVOICE WITH AN AMOUNT. ASK THE RECIPIENT FOR ONE. NO FUNDS WERE SENT.';
    case 'unavailable':
      return 'SATORA IS TEMPORARILY UNAVAILABLE. TRY AGAIN IN A FEW MINUTES. NO FUNDS WERE SENT.';
    case 'amount_limit':
      return `${friendlySatoraLimitError(reason)} NO FUNDS WERE SENT.`;
    case 'unknown':
      return null;
  }
}

/** What the user sees when Satora refuses for a reason we do not recognise. */
export function genericSatoraRefusal(status?: number): string {
  return status
    ? `SATORA REFUSED THIS PAYMENT (HTTP ${status}). NO FUNDS WERE SENT.`
    : 'SATORA REFUSED THIS PAYMENT. NO FUNDS WERE SENT.';
}

/**
 * What the diagnostic log may keep of a Satora refusal: a class of our
 * choosing, never the server's free text. A token, an e-mail or a payload
 * fragment in that text would otherwise sit in the log the user exports.
 */
export type SatoraRefusalClass =
  | 'network'
  | 'invoice_lifetime'
  | 'duplicate_swap'
  | 'invoice_expired'
  | 'invoice_paid'
  | 'no_route'
  | 'invalid_invoice'
  | 'amountless_invoice'
  | 'unavailable'
  | 'amount_limit'
  | 'unknown';

export function classifySatoraReason(reason: string): SatoraRefusalClass {
  const normalized = reason.toLowerCase();
  if (/failed to fetch|network request failed|networkerror|econn|enotfound|socket|timed out|timeout|aborted|unreachable/.test(normalized)
    && !/invoice timeout/.test(normalized)) return 'network';
  if (normalized.includes('invoice timeout too long') || normalized.includes('expires within')) return 'invoice_lifetime';
  if (normalized.includes('payment hash exists') || normalized.includes('swap already exists')) return 'duplicate_swap';
  if (normalized.includes('invoice expired') || normalized.includes('invoice has expired')) return 'invoice_expired';
  if (normalized.includes('already paid')) return 'invoice_paid';
  if (normalized.includes('no route') || normalized.includes('route not found') || normalized.includes('unable to find a path')) return 'no_route';
  if (normalized.includes('invalid invoice') || normalized.includes('invalid lightning invoice') || normalized.includes('could not decode')) return 'invalid_invoice';
  if (normalized.includes('amountless') || normalized.includes('amount is required') || normalized.includes('zero amount')) return 'amountless_invoice';
  if (normalized.includes('maintenance') || normalized.includes('temporarily unavailable') || normalized.includes('service unavailable')) return 'unavailable';
  if (friendlySatoraLimitError(reason)) return 'amount_limit';
  return 'unknown';
}

/** The diagnostic line for a refusal: status and class, nothing from the server. */
export function describeSatoraRefusal(status: number | undefined, reason: string): string {
  return `class=${classifySatoraReason(reason)} status=${status ?? 'none'} length=${reason.length}`;
}

/**
 * Satora wrapped in the SDK: the server's JSON body ends up verbatim in the
 * message ("Failed to create swap: {\"error\":\"...\"}"). Pull the reason out.
 */
export function extractSatoraReason(message: string): string | null {
  const match = message.match(/\{"error":"((?:[^"\\]|\\.)*)"\}/);
  return match ? match[1].replace(/\\"/g, '"').trim() || null : null;
}

export type SatoraContext = 'send' | 'receive' | 'refund' | 'status';

const GENERIC_BY_CONTEXT: Record<SatoraContext, string> = {
  send: 'SATORA REFUSED THIS PAYMENT. NO FUNDS WERE SENT.',
  receive: 'SATORA COULD NOT CREATE THIS RECEIVE REQUEST. TRY AGAIN LATER.',
  refund: 'SATORA COULD NOT PROCESS THE REFUND. YOUR FUNDS REMAIN RECOVERABLE. TRY AGAIN LATER.',
  status: 'SATORA COULD NOT REFRESH THIS SWAP. ALICE WILL KEEP CHECKING IT.',
};

const NETWORK_BY_CONTEXT: Record<SatoraContext, string> = {
  send: 'SATORA IS UNREACHABLE. CHECK YOUR CONNECTION AND TRY AGAIN. NO FUNDS WERE SENT.',
  receive: 'SATORA IS UNREACHABLE. CHECK YOUR CONNECTION AND TRY AGAIN.',
  refund: 'SATORA COULD NOT BROADCAST THE REFUND. YOUR FUNDS REMAIN RECOVERABLE. CHECK YOUR CONNECTION AND TRY AGAIN.',
  status: 'SATORA IS UNREACHABLE. ALICE WILL KEEP CHECKING THIS SWAP.',
};

/**
 * Satora said no, or could not be reached. The message is ours and fit for
 * the screen; the server's wording is kept nowhere, only its class.
 */
export class SatoraRefusalError extends Error {
  readonly status: number | undefined;
  readonly context: SatoraContext;
  readonly refusalClass: SatoraRefusalClass;
  /** Status and class for the diagnostic log; never the server's text. */
  readonly diagnostic: string;
  /** False when the message is the generic one for the context. */
  readonly recognized: boolean;

  constructor(reason: string, status: number | undefined, context: SatoraContext = 'send') {
    const refusalClass = reason ? classifySatoraReason(reason) : 'unknown';
    const friendly = context === 'send'
      ? (refusalClass === 'unknown' ? null : friendlySatoraReason(reason))
      : refusalClass === 'network' ? NETWORK_BY_CONTEXT[context] : null;
    super(friendly ?? (status && context === 'send' ? genericSatoraRefusal(status) : GENERIC_BY_CONTEXT[context]));
    this.name = 'SatoraRefusalError';
    this.status = status;
    this.context = context;
    this.refusalClass = refusalClass;
    this.diagnostic = describeSatoraRefusal(status, reason);
    this.recognized = friendly !== null;
  }
}

/**
 * Turns whatever the Satora SDK threw into a SatoraRefusalError. The SDK
 * embeds server bodies in its messages ("Failed to create swap: {...}",
 * "Broadcast failed: 500 - ..."), so nothing it throws may reach a screen
 * as is. Errors that are already ours pass through untouched.
 */
export function fromSatoraSdkError(error: unknown, context: SatoraContext): SatoraRefusalError {
  if (error instanceof SatoraRefusalError) return error;
  const message = error instanceof Error ? error.message : String(error ?? '');
  const reason = extractSatoraReason(message)
    ?? message.match(/^Failed to [a-z ]+: "((?:[^"\\]|\\.)*)"$/)?.[1]
    ?? message;
  return new SatoraRefusalError(reason, undefined, context);
}

/** Runs one SDK call under that rule. */
export async function satoraCall<T>(context: SatoraContext, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw fromSatoraSdkError(error, context);
  }
}
