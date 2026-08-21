// DCAP verification of a Venice TEE quote, wrapping @phala/dcap-qvl.
//
// Split in two:
//   - extractTdReport / TCB policy: pure, no network, unit-testable;
//   - verifyTdxQuote: the orchestration that fetches collateral and runs the
//     library's signature/TCB check. The collateral fetch and verify calls are
//     injectable so tests never touch the network, and so a caller can route
//     collateral through Alice's own PCCS relay instead of Phala directly.
//
// This module is the only place that imports @phala/dcap-qvl. The library is
// Apache-2.0 and pure JS (no WASM), so it loads on web, Tauri and, pending a
// real device test, React Native.

import { VeniceE2EEError } from './venice-e2ee-crypto.ts';
import { type VerifiedTdReport, tdFieldToHex } from './venice-attestation-verify.ts';

/**
 * TCB statuses accepted for the beta. Only `UpToDate`, anything else
 * (OutOfDate, Revoked, ConfigurationNeeded, SWHardeningNeeded, …) is refused
 * until a specific status is justified, documented and reviewed.
 */
export const BETA_ACCEPTABLE_TCB_STATUSES = new Set(['UpToDate']);

/** Shape of a @phala/dcap-qvl VerifiedReport, reduced to what we read. */
export type DcapVerifiedReport = {
  status: string;
  advisoryIds?: string[];
  advisory_ids?: string[];
  report: { type: string; data: Record<string, unknown> } | Record<string, unknown>;
};

function fieldHex(data: Record<string, unknown>, ...names: string[]): string {
  for (const n of names) {
    const v = data[n];
    if (v && typeof v === 'object') return tdFieldToHex(v as Record<string, number>);
    if (typeof v === 'string' && v) return v.trim().toLowerCase().replace(/^0x/, '');
  }
  return '';
}

/**
 * Convert a @phala/dcap-qvl verified report into the reduced shape the rest of
 * the chain consumes. TDX only, an SGX or unknown report type is refused,
 * because the measurement and report_data semantics differ.
 */
export function extractTdReport(verified: DcapVerifiedReport): VerifiedTdReport {
  const wrapper = verified.report as { type?: string; data?: Record<string, unknown> };
  const type = (wrapper?.type ?? '').toLowerCase();
  if (!type.startsWith('td')) {
    throw new VeniceE2EEError(`Attestation is not a TDX report (got "${wrapper?.type ?? 'unknown'}").`);
  }
  const data = (wrapper.data ?? {}) as Record<string, unknown>;

  const reportDataHex = fieldHex(data, 'reportData', 'report_data');
  const tdAttributesHex = fieldHex(data, 'tdAttributes', 'td_attributes');
  if (!reportDataHex) throw new VeniceE2EEError('TDX report carried no report_data.');
  if (!tdAttributesHex) throw new VeniceE2EEError('TDX report carried no TD attributes.');

  return {
    status: verified.status,
    tdAttributesHex,
    reportDataHex,
    measurements: {
      mrTd: fieldHex(data, 'mrTd', 'mr_td'),
      rtMr0: fieldHex(data, 'rtMr0', 'rt_mr0'),
      rtMr1: fieldHex(data, 'rtMr1', 'rt_mr1'),
      rtMr2: fieldHex(data, 'rtMr2', 'rt_mr2'),
      rtMr3: fieldHex(data, 'rtMr3', 'rt_mr3'),
      mrConfigId: fieldHex(data, 'mrConfigId', 'mr_config_id'),
    },
  };
}

/** Enforce the beta TCB policy. Separated so the accepted set is easy to audit. */
export function assertTcbStatus(status: string, accepted: Set<string> = BETA_ACCEPTABLE_TCB_STATUSES): void {
  if (!accepted.has(status)) {
    throw new VeniceE2EEError(`TEE TCB status not accepted for Private mode: ${status}.`);
  }
}

/** Injected collateral fetch: `(pccsUrl, quoteBytes) => collateral`. */
export type CollateralFetcher = (pccsUrl: string, quote: Uint8Array) => Promise<unknown>;
/** Injected verify: `(quoteBytes, collateral) => VerifiedReport`. */
export type QuoteVerifier = (quote: Uint8Array, collateral: unknown) => DcapVerifiedReport | Promise<DcapVerifiedReport>;

export type DcapOptions = {
  /** PCCS origin for collateral, Alice's relay Worker, or a Phala/Intel PCCS. */
  pccsUrl: string;
  getCollateral: CollateralFetcher;
  verify: QuoteVerifier;
  acceptedTcb?: Set<string>;
};

function hexToBytesStrict(hex: string): Uint8Array {
  const h = hex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(h) || h.length % 2 !== 0) {
    throw new VeniceE2EEError('TDX quote is not valid hex.');
  }
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Full DCAP path for one quote: fetch collateral, verify the signature/TCB
 * against Intel's trust chain, enforce the TCB policy, and return the reduced
 * TDX report. Fails closed, a collateral-fetch error (PCCS down) or a failed
 * verification both throw, and no report is returned.
 */
export async function verifyTdxQuote(quoteHex: string, options: DcapOptions): Promise<VerifiedTdReport> {
  const quote = hexToBytesStrict(quoteHex);

  let collateral: unknown;
  try {
    collateral = await options.getCollateral(options.pccsUrl, quote);
  } catch (err) {
    throw new VeniceE2EEError(
      `Could not fetch DCAP collateral: ${err instanceof Error ? err.message : 'PCCS unavailable'}.`,
    );
  }

  let verified: DcapVerifiedReport;
  try {
    verified = await options.verify(quote, collateral);
  } catch (err) {
    throw new VeniceE2EEError(
      `DCAP quote verification failed: ${err instanceof Error ? err.message : 'invalid quote'}.`,
    );
  }

  assertTcbStatus(verified.status, options.acceptedTcb);
  return extractTdReport(verified);
}
