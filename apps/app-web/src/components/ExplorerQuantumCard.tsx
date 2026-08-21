'use client';

// Quantum key-exposure card: whether this address's public key is already on
// chain. Shown only when the address holds funds (otherwise nothing is at risk).
// A hidden key is reassuring; an exposed key is a low-severity, forward-looking
// finding, never alarmist.

import type { QuantumExposure } from '@/lib/explorer/quantum';

const WARN = 'var(--alice-warning)';

const TYPE_LABEL: Record<QuantumExposure['addressType'], string> = {
  p2pkh: 'legacy (P2PKH)',
  p2sh: 'P2SH',
  p2wpkh: 'SegWit (P2WPKH)',
  p2tr: 'Taproot (P2TR)',
  unknown: 'unknown type',
};

export function ExplorerQuantumCard({ exposure }: { exposure: QuantumExposure }) {
  if (exposure.balanceSats <= 0) return null;
  const accent = exposure.exposed ? WARN : 'var(--alice-primary)';
  const why = exposure.exposedBySpend
    ? 'its public key is already on-chain because it has been spent from'
    : exposure.taproot
      ? 'a Taproot output publishes its public key on-chain'
      : 'its public key is still hidden behind a hash';
  return (
    <div
      className="flex flex-col gap-2 px-4 py-3"
      style={{ border: '1px solid var(--alice-border)', borderLeft: `3px solid ${accent}`, borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>QUANTUM EXPOSURE</span>
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, padding: '3px 6px', border: `1px solid ${accent}`, borderRadius: 2, color: accent }}>
          {exposure.exposed ? 'KEY EXPOSED' : 'KEY HIDDEN'}
        </span>
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--alice-muted)', borderRadius: 2, color: 'var(--alice-muted)' }}>
          {TYPE_LABEL[exposure.addressType]}
        </span>
      </div>
      <p className="font-numbers m-0" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--alice-muted)' }}>
        For the funds held here, {why}.{' '}
        {exposure.exposed
          ? 'These coins are the ones a future large-scale quantum computer could target first. Moving them to a fresh, never-spent, non-Taproot address hides the key again. No machine capable of this exists today.'
          : 'This is the more quantum-resistant state; spending from it will reveal the key.'}
      </p>
    </div>
  );
}
