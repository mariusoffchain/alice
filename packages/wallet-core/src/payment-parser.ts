import { isValidArkAddress } from '@arkade-os/sdk';
import { getInvoiceSatoshis } from '@arkade-os/boltz-swap';
import { decodeUnifiedBip21 } from '@alice-wallet/shared-types';
import type {
  ParsedPaymentRequest,
  PaymentInputKind,
  PaymentNetwork,
  PaymentRoute,
} from './payment-types';

const LIGHTNING_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function isBitcoinAddress(value: string, network: PaymentNetwork): boolean {
  const normalized = value.trim();
  if (network === 'mutinynet') {
    return /^(tb1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87}$/i.test(normalized);
  }
  return /^(bc1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87}$/i.test(normalized)
    || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(normalized);
}

function isBolt11(value: string, network: PaymentNetwork): boolean {
  const normalized = value.toLowerCase();
  const expectedPrefix = network === 'bitcoin' ? 'lnbc' : 'lntb';
  if (!normalized.startsWith(expectedPrefix)) return false;
  try {
    getInvoiceSatoshis(value);
    return true;
  } catch {
    return false;
  }
}

function bolt11Amount(value: string): number | null {
  if (!value) return null;
  try {
    const sats = getInvoiceSatoshis(value);
    return Number.isSafeInteger(sats) && sats > 0 ? sats : null;
  } catch {
    return null;
  }
}

function result(
  raw: string,
  kind: PaymentInputKind,
  network: PaymentNetwork,
  amountSats: number | null,
  routes: PaymentRoute[],
): ParsedPaymentRequest {
  return { raw, kind, network, amountSats, routes };
}

export function parsePaymentInput(
  input: string,
  network: PaymentNetwork = 'mutinynet',
): ParsedPaymentRequest | null {
  const raw = input.trim();
  if (!raw) return null;

  const unified = decodeUnifiedBip21(raw);
  if (unified) {
    const routes: PaymentRoute[] = [];
    if (unified.arkAddress && isValidArkAddress(unified.arkAddress)) {
      routes.push({ layer: 'arkade', destination: unified.arkAddress });
    }
    if (unified.bitcoinAddress && isBitcoinAddress(unified.bitcoinAddress, network)) {
      routes.push({ layer: 'onchain', destination: unified.bitcoinAddress });
    }
    if (unified.lightning && isBolt11(unified.lightning, network)) {
      routes.push({ layer: 'lightning', destination: unified.lightning, format: 'bolt11' });
    }
    return routes.length
      ? result(raw, 'bip21', network, unified.amountSats ?? bolt11Amount(unified.lightning), routes)
      : null;
  }

  const withoutScheme = raw.replace(/^(?:bitcoin|ark|arkade|lightning):(?:\/\/)?/i, '').trim();

  if (isValidArkAddress(withoutScheme)) {
    return result(raw, 'arkade-address', network, null, [
      { layer: 'arkade', destination: withoutScheme },
    ]);
  }

  if (isBitcoinAddress(withoutScheme, network)) {
    return result(raw, 'bitcoin-address', network, null, [
      { layer: 'onchain', destination: withoutScheme },
    ]);
  }

  if (isBolt11(withoutScheme, network)) {
    return result(raw, 'bolt11', network, bolt11Amount(withoutScheme), [
      { layer: 'lightning', destination: withoutScheme, format: 'bolt11' },
    ]);
  }

  if (/^lnurl[0-9a-z]+$/i.test(withoutScheme)) {
    return result(raw, 'lnurl', network, null, [
      { layer: 'lightning', destination: withoutScheme, format: 'lnurl' },
    ]);
  }

  if (LIGHTNING_ADDRESS.test(withoutScheme)) {
    return result(raw, 'lightning-address', network, null, [
      { layer: 'lightning', destination: withoutScheme, format: 'lightning-address' },
    ]);
  }

  return null;
}

export function selectPaymentRoute(
  request: ParsedPaymentRequest,
  preference: readonly PaymentRoute['layer'][] = ['arkade', 'lightning', 'onchain'],
): PaymentRoute | null {
  for (const layer of preference) {
    const route = request.routes.find(candidate => candidate.layer === layer);
    if (route) return route;
  }
  return null;
}
