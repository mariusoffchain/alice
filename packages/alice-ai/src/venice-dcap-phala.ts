// Platform adapter binding the pure DCAP chain to @phala/dcap-qvl.
//
// This is the ONLY module that imports the library, so the verification chain
// and its tests stay network- and dependency-free. It provides the two injected
// functions `verifyTdxQuote` expects, plus the default PCCS origin.
//
// The library is Apache-2.0 and pure JS (no WASM); it works on web and Tauri.
// React Native is NOT yet confirmed by a device run, do not treat mobile as
// verified until that test exists (see docs/security/private-cloud-e2ee.md).

import * as dcap from '@phala/dcap-qvl';
import { CollateralCache } from './venice-attestation-cache.ts';
import type { CollateralFetcher, DcapOptions, QuoteVerifier } from './venice-dcap.ts';

/** Phala's public PCCS. Prefer routing through Alice's relay in production. */
export const DEFAULT_PCCS_URL: string = (dcap as any).PHALA_PCCS_URL ?? 'https://pccs.phala.network';

const sharedCollateralCache = new CollateralCache();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Public cache identity from the quote. FMSPC identifies the platform TCB;
 * CA and TEE type prevent collateral from crossing incompatible quote classes.
 *
 * Some certification-data variants need a PCCS lookup before FMSPC can be
 * extracted. Those safely skip the cache instead of guessing a key.
 */
export function collateralCacheKey(quoteBytes: Uint8Array): string | null {
  try {
    const quote = (dcap as any).Quote.parse(quoteBytes);
    const fmspc = bytesToHex((dcap as any).intel.getFmspc(quote)).toUpperCase();
    const ca = String((dcap as any).intel.getCa(quote)).toLowerCase();
    const tee = quote.header.isSgx() ? 'sgx' : 'tdx';
    return `${fmspc}|${ca}|${tee}`;
  } catch {
    return null;
  }
}

export function cachedPhalaCollateral(
  cache: CollateralCache = sharedCollateralCache,
): CollateralFetcher {
  return async (pccsUrl, quote) => {
    const key = collateralCacheKey(quote);
    if (!key) return (dcap as any).getCollateral(pccsUrl, quote);
    return cache.getOrFetch(key, () => (dcap as any).getCollateral(pccsUrl, quote));
  };
}

export const phalaGetCollateral: CollateralFetcher = cachedPhalaCollateral();

export const phalaVerify: QuoteVerifier = (quote, collateral) =>
  (dcap as any).verify(quote, collateral, Math.floor(Date.now() / 1000));

/**
 * Ready-to-use DCAP options. Pass a relay PCCS URL (Alice's Worker) to keep the
 * user's IP off Phala; omit it to hit Phala's PCCS directly (documented
 * metadata leak: IP + timing + the public quote, never a prompt).
 */
export function phalaDcapOptions(
  pccsUrl: string = DEFAULT_PCCS_URL,
  cache: CollateralCache = sharedCollateralCache,
): DcapOptions {
  return {
    pccsUrl,
    getCollateral: cachedPhalaCollateral(cache),
    verify: phalaVerify,
  };
}
