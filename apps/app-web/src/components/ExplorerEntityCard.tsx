'use client';

// The entity card: "probably belongs to X". Shown when the address matches a
// sourced attribution. It never asserts certainty on its own: the wording, the
// confidence pill, the source link and the date are always present, so the user
// sees where the claim comes from and can judge it. This is privacy-audit
// context, not an accusation.

import type { EntityCategory, EntityConfidence, EntityLabel } from '@/lib/explorer/entities';

const CONFIDENCE_LEAD: Record<EntityConfidence, string> = {
  certain: 'Belongs to',
  strong: 'Very likely',
  possible: 'Possibly',
};

const CATEGORY_LABEL: Record<EntityCategory, string> = {
  exchange: 'exchange',
  payment: 'payment service',
  gambling: 'gambling',
  scam: 'scam',
  darknet: 'darknet market',
  mining: 'mining',
  mixer: 'mixer',
  p2p: 'peer-to-peer',
  asp: 'Ark service provider',
  sanctioned: 'sanctioned',
  unknown: 'entity',
};

function Row({ label }: { label: EntityLabel }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-text)' }}>
          {CONFIDENCE_LEAD[label.confidence]} {label.name}
        </span>
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--alice-muted)', borderRadius: 2, color: 'var(--alice-muted)' }}>
          {CATEGORY_LABEL[label.category]}
        </span>
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--alice-muted)', borderRadius: 2, color: 'var(--alice-muted)' }}>
          {label.confidence} confidence
        </span>
      </div>
      <span className="font-numbers" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>
        Source:{' '}
        <a href={label.source} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--alice-primary)' }}>
          {label.sourceLabel}
        </a>
        {' · verified '}{label.date}
      </span>
    </div>
  );
}

export function ExplorerEntityCard({ labels }: { labels: EntityLabel[] }) {
  if (labels.length === 0) return null;
  return (
    // Remote (Worker) labels can land after the page painted: fade in.
    <div
      className="flex flex-col gap-3 px-4 py-3 rh-fade-in"
      style={{ border: '1px solid var(--alice-border)', borderLeft: '3px solid var(--alice-primary)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
    >
      <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>ENTITY</span>
      {labels.map((l, i) => <Row key={`${l.name}-${l.source}-${i}`} label={l} />)}
      <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.7 }}>
        Attribution from public sources, always a probability, never proof. If this is your address, it means the link is visible on-chain to anyone.
      </p>
    </div>
  );
}
