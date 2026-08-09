import { bech32 } from '@scure/base';
import { getInvoiceSatoshis } from '@arkade-os/boltz-swap';
import { parsePaymentInput } from './payment-parser';
import type { ParsedPaymentRequest, PaymentNetwork } from './payment-types';
import { PAYMENT_NETWORK } from './network-config';

type LnurlPayMetadata = Array<[string, unknown]>;

type LnurlPayRequest = {
  tag?: string;
  callback?: string;
  minSendable?: number;
  maxSendable?: number;
  metadata?: string;
  allowsNostr?: boolean;
  nostrPubkey?: string;
  status?: string;
  reason?: string;
};

type LnurlPayInvoice = {
  pr?: string;
  routes?: unknown[];
  status?: string;
  reason?: string;
};

export type ResolvedLnurlPay = {
  invoice: string;
  amountSats: number;
  description: string | null;
  identifier: string;
  callback: string;
};

const LIGHTNING_ADDRESS = /^([a-z0-9._+-]+)@([^/@\s]+)$/i;

function bytesToString(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) output += String.fromCharCode(byte);
  return output;
}

function decodeLnurl(value: string): string {
  const normalized = value
    .trim()
    .replace(/^lightning:(?:\/\/)?/i, '')
    .toLowerCase();
  const decoded = bech32.decode(normalized as `${string}1${string}`, 2000);
  if (decoded.prefix !== 'lnurl') throw new Error('INVALID LNURL.');
  return bytesToString(new Uint8Array(bech32.fromWords(decoded.words)));
}

function lightningAddressToUrl(value: string): string {
  const normalized = value.trim().replace(/^lightning:(?:\/\/)?/i, '');
  const match = normalized.match(LIGHTNING_ADDRESS);
  if (!match) throw new Error('INVALID LIGHTNING ADDRESS.');
  const username = encodeURIComponent(match[1].toLowerCase());
  const domain = match[2].toLowerCase();
  const protocol = domain.endsWith('.onion') ? 'http' : 'https';
  return `${protocol}://${domain}/.well-known/lnurlp/${username}`;
}

export function lnurlPayUrlFromInput(input: string): string {
  const withoutScheme = input.trim().replace(/^lightning:(?:\/\/)?/i, '');
  if (/^lnurl[0-9a-z]+$/i.test(withoutScheme)) return decodeLnurl(withoutScheme);
  if (LIGHTNING_ADDRESS.test(withoutScheme)) return lightningAddressToUrl(withoutScheme);
  throw new Error('ENTER A LIGHTNING ADDRESS OR LNURL.');
}

function parseMetadata(metadata: string | undefined): LnurlPayMetadata {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function metadataValue(metadata: LnurlPayMetadata, type: string): string | null {
  const entry = metadata.find(item => item[0] === type);
  return typeof entry?.[1] === 'string' ? entry[1] : null;
}

function assertLnurlPayResponse(value: LnurlPayRequest): asserts value is LnurlPayRequest & {
  callback: string;
  minSendable: number;
  maxSendable: number;
} {
  if (value.status === 'ERROR') throw new Error(value.reason || 'LNURL SERVICE RETURNED AN ERROR.');
  if (value.tag !== 'payRequest') throw new Error('LNURL IS NOT A PAYMENT REQUEST.');
  if (!value.callback || typeof value.callback !== 'string') throw new Error('LNURL CALLBACK MISSING.');
  if (!Number.isFinite(value.minSendable) || !Number.isFinite(value.maxSendable)) {
    throw new Error('LNURL LIMITS MISSING.');
  }
}

export async function resolveLnurlPay(
  input: string,
  amountSats: number,
  network: PaymentNetwork = PAYMENT_NETWORK,
): Promise<ResolvedLnurlPay> {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error('ENTER A WHOLE NUMBER OF SATS.');
  }

  const url = lnurlPayUrlFromInput(input);
  const firstResponse = await fetch(url, { headers: { accept: 'application/json' } });
  if (!firstResponse.ok) throw new Error(`LNURL SERVICE UNREACHABLE (${firstResponse.status}).`);

  const payRequest = (await firstResponse.json()) as LnurlPayRequest;
  assertLnurlPayResponse(payRequest);

  const amountMsat = amountSats * 1000;
  if (amountMsat < payRequest.minSendable) {
    throw new Error(`LNURL MINIMUM: ${Math.ceil(payRequest.minSendable / 1000).toLocaleString('en-US')} SATS.`);
  }
  if (amountMsat > payRequest.maxSendable) {
    throw new Error(`LNURL MAXIMUM: ${Math.floor(payRequest.maxSendable / 1000).toLocaleString('en-US')} SATS.`);
  }

  const callback = new URL(payRequest.callback);
  callback.searchParams.set('amount', String(amountMsat));

  const invoiceResponse = await fetch(callback.toString(), { headers: { accept: 'application/json' } });
  if (!invoiceResponse.ok) throw new Error(`LNURL INVOICE FAILED (${invoiceResponse.status}).`);

  const invoiceData = (await invoiceResponse.json()) as LnurlPayInvoice;
  if (invoiceData.status === 'ERROR') throw new Error(invoiceData.reason || 'LNURL INVOICE ERROR.');
  if (!invoiceData.pr) throw new Error('LNURL SERVICE DID NOT RETURN AN INVOICE.');

  const parsedInvoice = parsePaymentInput(invoiceData.pr, network);
  const route = parsedInvoice?.routes.find(candidate => candidate.layer === 'lightning' && candidate.format === 'bolt11');
  if (!route) throw new Error('LNURL SERVICE RETURNED AN INVALID LIGHTNING INVOICE.');

  const invoiceSats = getInvoiceSatoshis(invoiceData.pr);
  if (invoiceSats !== amountSats) {
    throw new Error('LNURL INVOICE AMOUNT DOES NOT MATCH.');
  }

  const metadata = parseMetadata(payRequest.metadata);
  const description =
    metadataValue(metadata, 'text/plain')
    ?? metadataValue(metadata, 'text/identifier')
    ?? metadataValue(metadata, 'text/email');

  return {
    invoice: invoiceData.pr,
    amountSats: invoiceSats,
    description,
    identifier: input.trim(),
    callback: payRequest.callback,
  };
}

export async function resolveLightningRequestToBolt11(
  request: ParsedPaymentRequest,
  amountSats: number,
): Promise<ParsedPaymentRequest> {
  const route = request.routes.find(candidate => candidate.layer === 'lightning');
  if (!route) throw new Error('LIGHTNING REQUEST MISSING.');
  if (route.format === 'bolt11') return request;

  const resolved = await resolveLnurlPay(route.destination, amountSats, request.network);
  const invoiceRequest = parsePaymentInput(resolved.invoice, request.network);
  if (!invoiceRequest) throw new Error('LNURL SERVICE RETURNED AN INVALID INVOICE.');
  return invoiceRequest;
}
