import { CLIENT_AGENT, SATORA_SERVER_VERSION } from '@satora/swap';
import { describeSatoraRefusal, friendlySatoraReason, genericSatoraRefusal } from './satora-error-message.ts';

/**
 * Satora said no. The message is already fit for the screen; the server's
 * own wording is kept aside for the diagnostic log only.
 */
export class SatoraRefusalError extends Error {
  readonly status: number;
  /** Status and class for the diagnostic log; the server's text is not kept. */
  readonly diagnostic: string;
  /** False when the message is the generic refusal. */
  readonly recognized: boolean;

  constructor(reason: string, status: number) {
    const friendly = reason ? friendlySatoraReason(reason) : null;
    super(friendly ?? genericSatoraRefusal(status));
    this.name = 'SatoraRefusalError';
    this.status = status;
    this.diagnostic = describeSatoraRefusal(status, reason);
    this.recognized = friendly !== null;
  }
}
import { decodeInvoice } from '@arkade-os/boltz-swap';
import { bech32 } from '@scure/base';
import type { ParsedPaymentRequest, PaymentQuote } from './payment-types.ts';
import { PAYMENT_NETWORK, SATORA_URL } from './network-config.ts';

const QUOTE_TTL_MS = 60_000;
const QUOTE_TIMEOUT_MS = 10_000;
/** Satora locks funds for as long as the invoice lives, and caps that at a day. */
export const SATORA_MAX_INVOICE_LIFETIME_MS = 24 * 60 * 60 * 1_000;

// The dedicated Lightning-send quote: Satora prices THIS invoice, routing fee
// included, with the same numbers createSwap will apply. The generic /quote
// only knew an average fee, so the swap could come back a few sats apart from
// the figure the user had just confirmed, and the wallet rightly refused it.
interface SatoraLightningSendQuoteResponse {
  source_amount_sats: unknown;
  target_amount_sats: unknown;
  protocol_fee_sats: unknown;
  network_fee_sats: unknown;
  protocol_fee_rate: unknown;
  min_amount_sats: unknown;
  max_amount_sats: unknown;
}

export interface SatoraQuoteOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

function wholeSats(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw new Error(`Satora returned an invalid ${field}.`);
  }
  return Number(parsed);
}

function finiteNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Satora returned an invalid ${field}.`);
  }
  return parsed;
}

function bolt11Timestamp(invoice: string): number {
  const decoded = bech32.decode(
    invoice.toLowerCase() as `${string}1${string}`,
    5_000,
  );
  if (decoded.words.length < 7) {
    throw new Error('Satora returned a Lightning invoice without a timestamp.');
  }
  return decoded.words.slice(0, 7).reduce(
    (timestamp, word) => timestamp * 32 + word,
    0,
  );
}

/** Absolute expiry (unix seconds) whether the decoder gave a delta or an instant. */
export function absoluteBolt11Expiry(
  invoice: string,
  decodedExpiry: number,
): number {
  const timestamp = bolt11Timestamp(invoice);
  return decodedExpiry >= timestamp
    ? decodedExpiry
    : timestamp + decodedExpiry;
}

/**
 * Expiry of a BOLT11 invoice in milliseconds, or null when it cannot be read:
 * the pre-check below then stands aside and lets Satora judge the invoice.
 */
export function invoiceExpiryMs(invoice: string): number | null {
  try {
    const decoded = decodeInvoice(invoice);
    return absoluteBolt11Expiry(invoice, decoded.expiry) * 1_000;
  } catch {
    return null;
  }
}

function describeLifetime(ms: number): string {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

export async function quoteArkToLightningWithSatora(
  request: ParsedPaymentRequest,
  receiveAmountSats?: number,
  options: SatoraQuoteOptions = {},
): Promise<PaymentQuote> {
  if (request.network !== PAYMENT_NETWORK) {
    const expectedNetwork = PAYMENT_NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet';
    throw new Error(`This Satora payment request is not for ${expectedNetwork}.`);
  }

  const route = request.routes.find(
    candidate => candidate.layer === 'lightning' && candidate.format === 'bolt11',
  );
  if (!route) {
    const networkLabel = PAYMENT_NETWORK === 'bitcoin' ? 'Bitcoin Mainnet' : 'Mutinynet';
    throw new Error(`A valid ${networkLabel} Lightning invoice is required.`);
  }

  const requestedAmountSats = receiveAmountSats ?? request.amountSats;
  if (
    typeof requestedAmountSats !== 'number'
    || !Number.isSafeInteger(requestedAmountSats)
    || requestedAmountSats <= 0
  ) {
    throw new Error('This first Satora version requires an invoice with a fixed amount.');
  }
  const invoiceAmountSats = requestedAmountSats;

  // Said before any request: Satora refuses invoices that live longer than a
  // day, and some wallets (Spark-based ones) issue week-long invoices by
  // default. The refusal used to surface as a fake "server unreachable".
  const now = options.now?.() ?? Date.now();
  const expiresAt = invoiceExpiryMs(route.destination);
  if (expiresAt !== null && expiresAt - now > SATORA_MAX_INVOICE_LIFETIME_MS) {
    throw new Error(
      `Satora only pays Lightning invoices that expire within 24 hours, and this one is valid for ${describeLifetime(expiresAt - now)}. Ask the recipient for a shorter invoice. No funds were sent.`,
    );
  }

  const baseUrl = (options.baseUrl ?? SATORA_URL).replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Satora is not configured for this network.');
  }

  const quoteUrl = new URL(`${baseUrl}/quote/lightning-send`);
  quoteUrl.searchParams.set('lightning_invoice', route.destination);
  quoteUrl.searchParams.set('ref', 'alice-wallet');

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? QUOTE_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(quoteUrl.toString(), {
      method: 'GET',
      // Satora checks that a client speaks its current API version, on
      // quotes as on swaps: the SDK's own constants keep us in step with it.
      headers: {
        accept: 'application/json',
        'x-satora-server-version': SATORA_SERVER_VERSION,
        'X-Lendaswap-Client': CLIENT_AGENT,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Satora quote timed out. No funds were sent.');
    }
    throw new Error('Satora quote service is unreachable. No funds were sent.', {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // Satora explains its refusals in a JSON body. Only reasons we recognise
    // reach the screen, in our own words; the rest goes, sanitised, to the
    // diagnostic log, and the user sees a generic refusal with the status.
    let detail = '';
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body?.error === 'string' && body.error.trim()) detail = body.error.trim();
    } catch {
      // No readable body: the status will have to do.
    }
    throw new SatoraRefusalError(detail, response.status);
  }

  let parsedQuote: unknown;
  try {
    parsedQuote = await response.json();
  } catch (error) {
    throw new Error('Satora returned an unreadable quote. No funds were sent.', {
      cause: error,
    });
  }
  if (!parsedQuote || typeof parsedQuote !== 'object' || Array.isArray(parsedQuote)) {
    throw new Error('Satora returned an unreadable quote. No funds were sent.');
  }
  const rawQuote = parsedQuote as SatoraLightningSendQuoteResponse;

  const minAmountSats = wholeSats(rawQuote.min_amount_sats, 'minimum amount');
  const maxAmountSats = wholeSats(rawQuote.max_amount_sats, 'maximum amount');
  const targetAmountSats = wholeSats(rawQuote.target_amount_sats, 'target amount');
  const sendAmountSats = wholeSats(rawQuote.source_amount_sats, 'source amount');

  if (minAmountSats > maxAmountSats) {
    throw new Error('Satora returned invalid payment limits. No funds were sent.');
  }
  if (invoiceAmountSats < minAmountSats) {
    throw new Error(`Satora Lightning minimum: ${minAmountSats.toLocaleString('en-US')} sats.`);
  }
  if (invoiceAmountSats > maxAmountSats) {
    throw new Error(`Satora Lightning maximum: ${maxAmountSats.toLocaleString('en-US')} sats.`);
  }
  // The recipient gets exactly the invoice amount; every fee rides on top of
  // what the sender pays, and is shown on the confirmation screen as such.
  if (targetAmountSats !== invoiceAmountSats || sendAmountSats < invoiceAmountSats) {
    throw new Error('Satora quote does not fully cover the Lightning invoice. No funds were sent.');
  }

  const feeSats = sendAmountSats - invoiceAmountSats;

  return {
    id: `satora-ark-ln-${now}`,
    provider: 'satora',
    layer: 'lightning',
    request,
    sendAmountSats,
    receiveAmountSats: invoiceAmountSats,
    feeSats,
    expiresAt: now + QUOTE_TTL_MS,
    warnings: ['Satora fees are rechecked before the swap is created.'],
    providerData: {
      direction: 'ARKADE_TO_LIGHTNING',
      invoice: route.destination,
      networkFeeSats: wholeSats(rawQuote.network_fee_sats, 'network fee'),
      protocolFeeSats: wholeSats(rawQuote.protocol_fee_sats, 'protocol fee'),
      protocolFeeRate: finiteNumber(rawQuote.protocol_fee_rate, 'protocol fee rate'),
      limits: {
        min: minAmountSats,
        max: maxAmountSats,
      },
    },
  };
}
