'use client';

import type { PrivacySignal, SignalSeverity, SignalConfidence } from '@/lib/explorer/signals';

const SEVERITY_COLOR: Record<SignalSeverity, string> = {
  info: 'var(--alice-muted)',
  low: 'var(--alice-primary)',
  medium: '#e0a060',
  high: '#e06060',
};

function SignalCard({ signal }: { signal: PrivacySignal }) {
  const color = SEVERITY_COLOR[signal.severity];
  return (
    <div
      className="flex flex-col gap-2 px-4 py-3"
      style={{ border: '1px solid var(--alice-border)', borderRadius: 2, borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-text)' }}>
          {signal.title}
        </span>
        <span className="font-pixel tracking-widest" style={{ fontSize: 6, padding: '3px 6px', border: `1px solid ${color}`, borderRadius: 2, color }}>
          {severityLabel(signal.severity)}
        </span>
        <span
          className="font-pixel tracking-widest"
          style={{ fontSize: 6, padding: '3px 6px', border: '1px solid var(--alice-muted)', borderRadius: 2, color: 'var(--alice-muted)' }}
          title="How sure this is, independent of how serious it is."
        >
          {confidenceLabel(signal.confidence)}
        </span>
      </div>
      <p className="font-numbers m-0" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--alice-muted)' }}>
        {signal.detail}
      </p>
      {signal.subjects.map((s) => (
        <p key={s} className="font-numbers m-0 break-all" style={{ fontSize: 12, color: 'var(--alice-text)', opacity: 0.7 }}>
          {s}
        </p>
      ))}
    </div>
  );
}

function severityLabel(s: SignalSeverity): string {
  return s.toUpperCase();
}

function confidenceLabel(c: SignalConfidence): string {
  return `${c.toUpperCase()} CONFIDENCE`;
}

export function ExplorerSignals({
  signals,
  analyzing,
  degraded,
}: {
  signals: PrivacySignal[];
  analyzing: boolean;
  degraded: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
        PRIVACY SIGNALS
      </span>

      {analyzing ? (
        <p className="font-numbers m-0" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
          Checking addresses for reuse...
        </p>
      ) : signals.length === 0 ? (
        <p className="font-numbers m-0" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
          No address reuse detected in this transaction.
          {degraded ? ' Some address history could not be read, so this is not a guarantee.' : ''}
        </p>
      ) : (
        <>
          {signals.map((s) => <SignalCard key={s.id} signal={s} />)}
          {degraded && (
            <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-muted)', opacity: 0.7 }}>
              Some address history could not be read, so more reuse may exist than shown.
            </p>
          )}
        </>
      )}
    </div>
  );
}
