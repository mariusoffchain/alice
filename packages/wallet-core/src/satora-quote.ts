import type { ParsedPaymentRequest, PaymentQuote } from './payment-types.ts';
import { PAYMENT_NETWORK, SATORA_URL } from './network-config.ts';

const QUOTE_TTL_MS = 60_000;
const QUOTE_TIMEOUT_MS = 10_000;

interface SatoraQuoteResponse {
  exchange_rate: unknown;
  network_fee: unknown;
  gasless_network_fee: unknown;
  protocol_fee: unknown;
  protocol_fee_rate: unknown;
  min_amount: unknown;
  max_amount: unknown;
  source_amount: unknown;
  target_amount: unknown;
  net_source_amount: unknown;
  net_target_amount: unknown;
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

  const baseUrl = (options.baseUrl ?? SATORA_URL).replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Satora is not configured for this network.');
  }

  const quoteUrl = new URL(`${baseUrl}/quote`);
  quoteUrl.searchParams.set('source_chain', 'Arkade');
  quoteUrl.searchParams.set('source_token', 'btc');
  quoteUrl.searchParams.set('target_chain', 'Lightning');
  quoteUrl.searchParams.set('target_token', 'btc');
  quoteUrl.searchParams.set('target_amount', String(invoiceAmountSats));

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? QUOTE_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(quoteUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
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
    throw new Error(`Satora quote failed with HTTP ${response.status}. No funds were sent.`);
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
  const rawQuote = parsedQuote as SatoraQuoteResponse;

  const minAmountSats = wholeSats(rawQuote.min_amount, 'minimum amount');
  const maxAmountSats = wholeSats(rawQuote.max_amount, 'maximum amount');
  const targetAmountSats = wholeSats(rawQuote.target_amount, 'target amount');
  const netTargetAmountSats = wholeSats(rawQuote.net_target_amount, 'net target amount');
  const sendAmountSats = wholeSats(rawQuote.net_source_amount, 'net source amount');

  if (minAmountSats > maxAmountSats) {
    throw new Error('Satora returned invalid payment limits. No funds were sent.');
  }
  if (invoiceAmountSats < minAmountSats) {
    throw new Error(`Satora Lightning minimum: ${minAmountSats.toLocaleString('en-US')} sats.`);
  }
  if (invoiceAmountSats > maxAmountSats) {
    throw new Error(`Satora Lightning maximum: ${maxAmountSats.toLocaleString('en-US')} sats.`);
  }
  if (
    targetAmountSats !== invoiceAmountSats
    || netTargetAmountSats !== invoiceAmountSats
    || sendAmountSats < invoiceAmountSats
  ) {
    throw new Error('Satora quote does not fully cover the Lightning invoice. No funds were sent.');
  }

  const feeSats = sendAmountSats - invoiceAmountSats;
  const now = options.now?.() ?? Date.now();

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
      exchangeRate: finiteNumber(rawQuote.exchange_rate, 'exchange rate'),
      networkFeeSats: wholeSats(rawQuote.network_fee, 'network fee'),
      gaslessNetworkFeeSats: wholeSats(
        rawQuote.gasless_network_fee,
        'gasless network fee',
      ),
      protocolFeeSats: wholeSats(rawQuote.protocol_fee, 'protocol fee'),
      protocolFeeRate: finiteNumber(
        rawQuote.protocol_fee_rate,
        'protocol fee rate',
      ),
      limits: {
        min: minAmountSats,
        max: maxAmountSats,
      },
    },
  };
}
