// Versioned measurement governance for Private Cloud.
//
// A DCAP-verified quote proves "a genuine, TCB-current, non-debug Intel TDX
// enclave". Pinning its measurements to a known-good reference is what proves
// "the specific code Alice approves". This module is the policy layer: which
// references are allowed, how rotation works, and how unknown values are
// refused.
//
// It ships EMPTY on purpose. The authoritative reference values come from
// dstack governance (DstackKms.allowedOsImages for MRTD/RTMR0-2, DstackApp's
// allowed compose-hash for RTMR3) via Phala trust-center / dstack-verifier run
// against Venice's app-id. They are NOT invented here, and an empty policy is
// treated as "not yet anchored", never as "anything goes".

import { VeniceE2EEError } from './venice-e2ee-crypto.ts';
import type { VerifiedTdReport } from './venice-attestation-verify.ts';

/**
 * One approved measurement set. Every field that is present must match exactly;
 * a field left undefined is not constrained (e.g. before RTMR3 pinning is
 * available). At least one field must be set for the reference to mean anything.
 */
export type MeasurementReference = {
  /** Stable identifier for logs and revocation, e.g. "venice-gpt-oss-2026-07". */
  id: string;
  /** Human note: which model/app version and where the value came from. */
  label?: string;
  /** Governance source, e.g. a DstackApp address + compose-hash. */
  source?: string;
  /** ISO date this reference becomes valid (inclusive). */
  notBefore?: string;
  /** ISO date this reference stops being valid (exclusive). */
  notAfter?: string;
  /** Hard kill switch: a revoked reference never matches, whatever the dates. */
  revoked?: boolean;
  mrTd?: string;
  rtMr0?: string;
  rtMr1?: string;
  rtMr2?: string;
  rtMr3?: string;
};

export type MeasurementPolicy = {
  /**
   * Approved references. Empty means "no pinning configured yet". Multiple
   * entries are allowed so a rotation can accept both the old and the new set
   * during the cut-over window.
   */
  references: MeasurementReference[];
};

/** An empty, unanchored policy. Callers must decide what that means (see below). */
export const EMPTY_MEASUREMENT_POLICY: MeasurementPolicy = { references: [] };

const MEASUREMENT_FIELDS = ['mrTd', 'rtMr0', 'rtMr1', 'rtMr2', 'rtMr3'] as const;
type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

export function policyIsAnchored(policy: MeasurementPolicy | undefined): boolean {
  return !!policy && policy.references.some(referenceIsMeaningful);
}

function referenceIsMeaningful(ref: MeasurementReference): boolean {
  return MEASUREMENT_FIELDS.some(f => typeof ref[f] === 'string' && (ref[f] as string).length > 0);
}

function withinWindow(ref: MeasurementReference, now: Date): boolean {
  if (ref.notBefore && now < new Date(ref.notBefore)) return false;
  if (ref.notAfter && now >= new Date(ref.notAfter)) return false;
  return true;
}

function norm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^0x/, '');
}

/** A reference matches only if every field it pins equals the report's value. */
function referenceMatches(ref: MeasurementReference, m: VerifiedTdReport['measurements']): boolean {
  let constrained = false;
  for (const f of MEASUREMENT_FIELDS) {
    const expected = ref[f];
    if (!expected) continue;
    constrained = true;
    if (norm(expected) !== norm(m[f])) return false;
  }
  return constrained; // an all-undefined reference never matches
}

export type MeasurementMatch = {
  id: string;
  label?: string;
  source?: string;
};

/**
 * Find the active reference the report matches. Skips revoked and out-of-window
 * references, so rotation is just "add the new reference, later revoke the old".
 * Returns the match, or throws — an unknown measurement is a refusal, never a
 * pass. Callers must NOT invoke this on an unanchored policy; use
 * `policyIsAnchored` to decide the assurance level first.
 */
export function selectMatchingReference(
  measurements: VerifiedTdReport['measurements'],
  policy: MeasurementPolicy,
  now: Date = new Date(),
): MeasurementMatch {
  if (!policyIsAnchored(policy)) {
    throw new VeniceE2EEError('No measurement reference is configured; cannot pin the enclave.');
  }
  for (const ref of policy.references) {
    if (ref.revoked) continue;
    if (!referenceIsMeaningful(ref)) continue;
    if (!withinWindow(ref, now)) continue;
    if (referenceMatches(ref, measurements)) {
      return { id: ref.id, label: ref.label, source: ref.source };
    }
  }
  throw new VeniceE2EEError('Enclave measurements do not match any approved reference.');
}
