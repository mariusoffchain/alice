// Client-side checks on a Venice TEE attestation, beyond "the JSON said
// verified: true".
//
// These are the pure, platform-agnostic parts, validated against a real
// production quote:
//   - the enclave is not in debug mode (TD_ATTRIBUTES debug bit),
//   - the key we are about to encrypt to is the one the attested enclave
//     committed to (report_data binds the signing address),
//   - the request nonce is inside that signed report_data, not merely echoed in
//     unauthenticated JSON.
//
// They are only meaningful once the TDX quote's SIGNATURE has been verified
// against Intel's trust chain (DCAP), otherwise a malicious relay could forge
// a consistent quote + report_data + key. The DCAP signature/TCB step and the
// measurement-pinning policy live in the integration layer; see
// verifyTdReportBinding's contract below.

import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { VeniceE2EEError, assertUncompressedPublicKey } from './venice-e2ee-crypto.ts';

/**
 * Ethereum-style address of a secp256k1 key: last 20 bytes of
 * keccak256(uncompressed_pubkey without its 0x04 prefix). This is how the TEE
 * derives the signing_address that ends up in the quote's report_data.
 */
export function deriveSigningAddress(publicKeyHex: string): string {
  const pub = assertUncompressedPublicKey(publicKeyHex, 'signing public key');
  return bytesToHex(keccak_256(pub.slice(1)).slice(-20));
}

function normalizeHex(value: string, label: string): string {
  const h = value.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(h)) throw new VeniceE2EEError(`Invalid ${label}: not hex.`);
  return h;
}

/**
 * TD_ATTRIBUTES is 8 bytes; the DEBUG flag is bit 0 of the first byte. A
 * debug-enabled TD gives no confidentiality guarantee, so refuse it.
 */
export function assertNotDebug(tdAttributesHex: string): void {
  const h = normalizeHex(tdAttributesHex, 'td_attributes');
  if (h.length < 2) throw new VeniceE2EEError('Attestation carried no TD attributes.');
  const firstByte = parseInt(h.slice(0, 2), 16);
  if ((firstByte & 0x01) !== 0) {
    throw new VeniceE2EEError('TEE is in debug mode; refusing to send anything.');
  }
}

/**
 * The binding check: the first 20 bytes of the quote's report_data must equal
 * the address derived from the model's signing public key. This is what stops a
 * relay from swapping in a key it controls, it cannot produce a valid quote
 * whose report_data matches a foreign key.
 *
 * `reportDataHex` MUST come from a DCAP-verified quote, not from an unauthenticated
 * JSON field, or the guarantee is void.
 */
export function assertReportDataBinding(reportDataHex: string, signingPublicKeyHex: string): void {
  const report = normalizeHex(reportDataHex, 'report_data');
  if (report.length < 40) throw new VeniceE2EEError('report_data too short to carry an address.');
  const embeddedAddress = report.slice(0, 40);
  const derived = deriveSigningAddress(signingPublicKeyHex);
  if (embeddedAddress !== derived) {
    throw new VeniceE2EEError('Attested key does not match the signing address in report_data.');
  }
}

/**
 * dstack vllm-proxy v1 layout:
 *   report_data[0:32]  = signing address (20 bytes) + zero padding (12 bytes)
 *   report_data[32:64] = request nonce (32 bytes)
 *
 * Checking the JSON nonce alone is insufficient because a relay could copy a
 * fresh nonce beside a replayed quote. This check binds freshness to the quote.
 */
export function assertReportDataNonce(reportDataHex: string, expectedNonceHex: string): void {
  const report = normalizeHex(reportDataHex, 'report_data');
  const nonce = normalizeHex(expectedNonceHex, 'attestation nonce');
  if (report.length !== 128) {
    throw new VeniceE2EEError('report_data must be exactly 64 bytes.');
  }
  if (nonce.length !== 64) {
    throw new VeniceE2EEError('Attestation nonce must be exactly 32 bytes.');
  }
  if (report.slice(64) !== nonce) {
    throw new VeniceE2EEError('Attestation nonce is not bound to report_data.');
  }
}

/** A DCAP-verified TDX report, reduced to the fields these checks read. */
export type VerifiedTdReport = {
  /** Verification status from the DCAP verifier, e.g. "UpToDate". */
  status: string;
  tdAttributesHex: string;
  reportDataHex: string;
  /** MRTD + RTMRs, hex. Carried for measurement pinning (see contract). */
  measurements: {
    mrTd: string;
    rtMr0: string;
    rtMr1: string;
    rtMr2: string;
    rtMr3: string;
    mrConfigId: string;
  };
};

/** TCB statuses we treat as acceptable. Anything else is refused. */
export const ACCEPTABLE_TCB_STATUSES = new Set(['UpToDate']);

/**
 * Known-good measurements to pin, hex. This is what turns "a genuine TDX
 * enclave" into "the specific code we trust".
 *
 * Authority (per dstack): MRTD + RTMR0-2 are the OS/hardware layer, whitelisted
 * on-chain by `DstackKms.allowedOsImages` and reproducible from meta-dstack.
 * RTMR3 carries the app compose-hash, whitelisted by the `DstackApp` contract, * change one byte of Venice's compose and RTMR3 won't match. Values must come
 * from an authoritative source (Phala trust-center / dstack-verifier against
 * Venice's app-id, or a reproducible build), never invented here.
 *
 * Every field is optional so callers can pin as much as they have. An empty
 * object pins nothing and is treated as "not yet anchored".
 */
export type PinnedMeasurements = Partial<{
  mrTd: string;
  rtMr0: string;
  rtMr1: string;
  rtMr2: string;
  rtMr3: string;
}>;

/** True when a set of pinned measurements actually constrains anything. */
export function hasPinnedMeasurements(pins: PinnedMeasurements | undefined): boolean {
  return !!pins && Object.values(pins).some(v => typeof v === 'string' && v.length > 0);
}

/**
 * Compare the report's measurements against pinned values. Only the fields
 * present in `pins` are checked; a field the report is missing while pinned is a
 * failure, not a skip.
 */
export function assertPinnedMeasurements(
  measurements: VerifiedTdReport['measurements'],
  pins: PinnedMeasurements,
): void {
  for (const key of ['mrTd', 'rtMr0', 'rtMr1', 'rtMr2', 'rtMr3'] as const) {
    const expected = pins[key];
    if (!expected) continue;
    const actual = (measurements[key] ?? '').trim().toLowerCase();
    if (actual !== expected.trim().toLowerCase()) {
      throw new VeniceE2EEError(`TEE measurement ${key} does not match the pinned value.`);
    }
  }
}

/**
 * Run the checks against an already-DCAP-verified report.
 *
 * Contract, what the caller MUST have done first:
 *   The report MUST come from a verifier that checked the quote signature
 *   against Intel's trust chain (e.g. @phala/dcap-qvl >= 0.3.9, avoiding
 *   CVE-2026-22696). This function trusts `report` is authentic.
 *
 * Trust levels:
 *   - Without `pins`, this proves "a genuine, TCB-current, non-debug Intel TDX
 *     enclave that committed to this key", NOT "Venice's specific code". The UI
 *     must not claim trustless end-to-end encryption in this state.
 *   - With `pins`, it additionally proves the enclave runs the pinned OS image
 *     and app compose-hash, which is what backs a real E2EE claim.
 */
export function verifyTdReportBinding(
  report: VerifiedTdReport,
  signingPublicKeyHex: string,
  expectedNonceHex: string,
  pins?: PinnedMeasurements,
): void {
  if (!ACCEPTABLE_TCB_STATUSES.has(report.status)) {
    throw new VeniceE2EEError(`TEE TCB status not acceptable: ${report.status}.`);
  }
  assertNotDebug(report.tdAttributesHex);
  assertReportDataBinding(report.reportDataHex, signingPublicKeyHex);
  assertReportDataNonce(report.reportDataHex, expectedNonceHex);
  if (hasPinnedMeasurements(pins)) {
    assertPinnedMeasurements(report.measurements, pins!);
  }
}

/** Convert a dcap-qvl td10 `report.data` (byte-map fields) to hex. */
export function tdFieldToHex(field: Record<string, number> | undefined): string {
  if (!field) return '';
  return Object.keys(field)
    .map(k => (field[k] & 0xff).toString(16).padStart(2, '0'))
    .join('');
}

// Re-export for callers that only need the address helper.
export { hexToBytes };
