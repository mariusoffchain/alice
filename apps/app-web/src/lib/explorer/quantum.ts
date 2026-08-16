// Quantum key exposure, in the spirit of BitGo's resistance score, computed from
// public on-chain data. When you spend from an address, its public key is
// published forever; a Taproot output publishes the key immediately. So a coin
// sitting on an address whose key is already on-chain is the one a future
// large-scale quantum computer could target first. This is a forward-looking,
// speculative threat, so it is low severity, but the exposure itself is a fact.
//
// Pure: reads the address string and its stats, no network.

import { magnitudeBucket } from './audit-core.ts';
import type { AddressStats, PrivacySignal } from './signals.ts';

export type AddressType = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2tr' | 'unknown';

export function addressType(address: string): AddressType {
  const a = address.trim();
  if (/^(bc1p|tb1p|bcrt1p)/i.test(a)) return 'p2tr';
  if (/^(bc1q|tb1q|bcrt1q)/i.test(a)) return 'p2wpkh';
  if (/^[1mn]/.test(a)) return 'p2pkh';
  if (/^[23]/.test(a)) return 'p2sh';
  return 'unknown';
}

export type QuantumExposure = {
  /** The public key is already visible on-chain for this address. */
  exposed: boolean;
  /** Exposed because the address has been spent from (its key was revealed). */
  exposedBySpend: boolean;
  /** Exposed because it is a Taproot output (the output IS a public key). */
  taproot: boolean;
  addressType: AddressType;
  balanceSats: number;
};

/**
 * Assess one address. A hash-based address (P2PKH/P2SH/P2WPKH) hides its key
 * until it is first spent; a Taproot address exposes it from the start. Spending
 * from any address reveals its key. Only the balance still held is at risk.
 */
export function analyzeQuantumExposure(address: string, stats: AddressStats): QuantumExposure {
  const type = addressType(address);
  const taproot = type === 'p2tr';
  const exposedBySpend = stats.spentCount > 0;
  const balanceSats = Math.max(0, stats.fundedSum - stats.spentSum);
  return {
    exposed: taproot || exposedBySpend,
    exposedBySpend,
    taproot,
    addressType: type,
    balanceSats,
  };
}

/**
 * A QUANTUM_EXPOSURE signal, only when funds are held on a key-exposed address.
 * No funds, or a key still hidden, is not a finding.
 */
export function detectQuantumExposure(address: string, stats: AddressStats): PrivacySignal[] {
  const q = analyzeQuantumExposure(address, stats);
  if (!q.exposed || q.balanceSats <= 0) return [];
  const why = q.exposedBySpend
    ? 'because it has already been spent from'
    : 'because a Taproot output publishes its key';
  return [{
    id: `QUANTUM_EXPOSURE:${address}`,
    ruleId: 'QUANTUM_EXPOSURE',
    severity: 'low',
    confidence: 'certain',
    title: 'Quantum-exposed key',
    detail:
      `This address's public key is already visible on-chain, ${why}. Funds left on a ` +
      'key-exposed address are the ones a future large-scale quantum computer could target ' +
      'first. Moving them to a fresh, never-spent, non-Taproot address hides the key again.',
    subjects: [address],
    evidence: {
      exposedBySpend: q.exposedBySpend,
      taproot: q.taproot,
      addressType: q.addressType,
      balanceBucket: magnitudeBucket(q.balanceSats),
    },
  }];
}
