// The full Private Cloud verification chain, composed from the pieces.
//
// Order (fail-closed at every step, nothing leaves the device until it passes):
//   1. attestation shape + nonce binding
//   2. parse + DCAP-verify the TDX quote (Intel trust chain), strict TCB
//   3. reject debug mode
//   4. bind the E2EE key to report_data
//   5. pin measurements to an approved reference (if a policy is anchored)
//   6. NVIDIA GPU attestation (if required for the model)
//
// The result carries an explicit assurance level so callers, and the UI, can
// tell "hardware-attested" apart from "fully pinned". The UI must not claim
// end-to-end encryption below `full`.

import { VeniceE2EEError, assertUncompressedPublicKey } from './venice-e2ee-crypto.ts';
import { verifyTdReportBinding, type VerifiedTdReport } from './venice-attestation-verify.ts';
import { verifyTdxQuote, type DcapOptions } from './venice-dcap.ts';
import {
  policyIsAnchored,
  selectMatchingReference,
  type MeasurementMatch,
  type MeasurementPolicy,
} from './venice-measurement-policy.ts';

export type AssuranceLevel =
  // DCAP + non-debug + key binding verified, but measurements are NOT pinned to
  // an approved reference. Proves "a genuine TDX enclave that committed to this
  // key", NOT "Venice's specific approved code". UI must not say E2EE-verified.
  | 'attested-unpinned'
  // The above, plus measurements matched an approved reference. For a model that
  // does not require GPU attestation this is the full guarantee.
  | 'pinned'
  // The above, plus a verified NVIDIA GPU attestation where required.
  | 'full';

export type AttestationChainResult = {
  modelPublicKey: Uint8Array;
  modelPublicKeyHex: string;
  signingAddress?: string;
  assurance: AssuranceLevel;
  tcbStatus: string;
  measurementMatch?: MeasurementMatch;
  nvidiaVerified: boolean;
};

/** Verifies an NVIDIA GPU attestation payload. Injected; see requireNvidia. */
export type NvidiaVerifier = (payload: unknown, nonce: string) => boolean | Promise<boolean>;

export type ChainPolicy = {
  dcap: DcapOptions;
  measurements: MeasurementPolicy;
  /**
   * When true, an unanchored measurement policy is a hard refusal instead of a
   * lower assurance level. Turn this on once Venice's reference values are
   * pinned, until then it stays false and the UI stays honest about the level.
   */
  requireMeasurementPinning: boolean;
  /**
   * When true, a model whose attestation carries an NVIDIA payload must have it
   * verified, or the session is refused. No fallback. If no verifier is wired,
   * this refuses, never silently skips.
   */
  requireNvidia: boolean;
  nvidiaVerify?: NvidiaVerifier;
  now?: Date;
};

/** Read the model E2EE key from the attestation. Real field is signing_public_key. */
function readModelKey(data: any): { hex: string; bytes: Uint8Array; address?: string } {
  const key = data?.signing_public_key ?? data?.signing_key ?? data?.signingKey;
  if (typeof key !== 'string' || !key) {
    throw new VeniceE2EEError('Attestation carried no signing public key.');
  }
  return {
    hex: key.trim().toLowerCase(),
    bytes: assertUncompressedPublicKey(key, 'attestation signing key'),
    address: typeof data?.signing_address === 'string' ? data.signing_address : undefined,
  };
}

function readQuoteHex(data: any): string {
  const q = data?.intel_quote ?? data?.attestation?.evidence?.quote ?? data?.quote;
  if (typeof q !== 'string' || !q) {
    throw new VeniceE2EEError('Attestation carried no TDX quote.');
  }
  return q;
}

/**
 * Run the whole chain. `expectedNonce` is the 32-byte hex nonce the caller sent;
 * `attestation` is the parsed JSON from the attestation endpoint.
 */
export async function verifyAttestationChain(
  attestation: any,
  expectedNonce: string,
  policy: ChainPolicy,
): Promise<AttestationChainResult> {
  if (!attestation || typeof attestation !== 'object') {
    throw new VeniceE2EEError('Attestation response was empty.');
  }

  // 1. nonce binding (freshness + anti-replay).
  const echoedNonce = attestation.nonce ?? attestation.client_nonce;
  if (typeof echoedNonce !== 'string' || echoedNonce.toLowerCase() !== expectedNonce.toLowerCase()) {
    throw new VeniceE2EEError('Attestation nonce mismatch.');
  }

  const model = readModelKey(attestation);
  const quoteHex = readQuoteHex(attestation);

  // 2. DCAP: parse, verify signature against Intel, strict TCB. Throws on any
  // failure (including PCCS unavailable), so nothing proceeds unverified.
  const report: VerifiedTdReport = await verifyTdxQuote(quoteHex, policy.dcap);

  // 3 + 4. non-debug and key<->report_data binding, against the VERIFIED report.
  verifyTdReportBinding(report, model.hex, expectedNonce);

  // 5. measurement pinning.
  let measurementMatch: MeasurementMatch | undefined;
  let assurance: AssuranceLevel;
  if (policyIsAnchored(policy.measurements)) {
    measurementMatch = selectMatchingReference(report.measurements, policy.measurements, policy.now);
    assurance = 'pinned';
  } else if (policy.requireMeasurementPinning) {
    throw new VeniceE2EEError('Measurement pinning is required but no reference is configured.');
  } else {
    assurance = 'attested-unpinned';
  }

  // 6. NVIDIA GPU attestation, when the model provides a payload.
  const nvidiaPayload = attestation.nvidia_payload ?? attestation.nvidiaPayload;
  let nvidiaVerified = false;
  if (nvidiaPayload != null) {
    if (policy.nvidiaVerify) {
      nvidiaVerified = await policy.nvidiaVerify(nvidiaPayload, expectedNonce);
      if (!nvidiaVerified && policy.requireNvidia) {
        throw new VeniceE2EEError('NVIDIA GPU attestation failed.');
      }
    } else if (policy.requireNvidia) {
      // Required but nothing can verify it: refuse rather than pretend.
      throw new VeniceE2EEError('NVIDIA GPU attestation is required but not verified.');
    }
  }
  if (assurance === 'pinned' && (nvidiaPayload == null || nvidiaVerified)) {
    // Full only when nothing GPU-related is left unverified.
    assurance = 'full';
  }

  return {
    modelPublicKey: model.bytes,
    modelPublicKeyHex: model.hex,
    signingAddress: model.address,
    assurance,
    tcbStatus: report.status,
    measurementMatch,
    nvidiaVerified,
  };
}
