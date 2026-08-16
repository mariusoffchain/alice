'use client';

// The address's unspent outputs as packed circles, echoing mempool.space's
// "Unspent Outputs" view but in the Alice palette: one circle per UTXO, area is
// value, the biggest coins carry a label. It answers "how is this balance split
// up, and how chunky is each piece?" at a glance.

import { useMemo, useState } from 'react';
import { packUtxos, type PackInput } from '@/lib/explorer/utxo-pack';
import { formatAmount, formatAmountShort, useAmountState } from '@/components/AmountDisplay';

// All circles use the theme's accent colour; size still reads value, and the
// chunkier coins carry a touch more opacity so they stand out a little.
function fillOpacity(ratio: number): number {
  return 0.5 + ratio * 0.45;
}


export function ExplorerUtxoBubbles({ utxos, confidential = false, title = 'UNSPENT OUTPUTS' }: {
  utxos: PackInput[];
  confidential?: boolean;
  /** Panel heading; Arkade shows the same view for its spendable VTXOs. */
  title?: string;
}) {
  const unit = useAmountState();
  // On Liquid the amounts are blinded: pack every coin at an equal nominal size
  // so the graph still shows how many outputs there are (and that there is only
  // one, when there is), without pretending to know their values.
  const packInput = useMemo(
    () => (confidential ? utxos.map(u => ({ ...u, valueSats: 1 })) : utxos),
    [utxos, confidential],
  );
  const layout = useMemo(() => packUtxos(packInput), [packInput]);
  const [hover, setHover] = useState<number | null>(null);

  if (layout.circles.length === 0) return null;

  const held = utxos.reduce((s, u) => s + u.valueSats, 0);
  const capped = utxos.length > layout.shown;

  return (
    <div
      className="flex flex-col gap-2 px-4 py-3"
      style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
    >
      <div className="flex items-center justify-between">
        <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
          {title}
        </span>
        <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
          {utxos.length.toLocaleString('en-US')} coin{utxos.length > 1 ? 's' : ''} - {confidential ? 'amount hidden' : formatAmount(held, unit)}
        </span>
      </div>

      {/* Rendered at its natural pixel size (capped to the panel width), so the
          biggest coin is a fixed size on every address rather than stretching to
          fill the row. */}
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        style={{ display: 'block', maxWidth: '100%', height: 'auto', maxHeight: 340, margin: '4px auto' }}
        role="img"
        aria-label={`${utxos.length} unspent outputs, packed by value`}
      >
        {layout.circles.map((c, i) => {
          const ratio = c.r / layout.maxR;
          const labelled = !confidential && c.r >= layout.maxR * 0.5;
          const isHover = hover === i;
          return (
            <g
              key={i}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(h => (h === i ? null : h))}
              style={{ cursor: 'default' }}
            >
              <circle
                cx={c.x}
                cy={c.y}
                r={c.r}
                fill="var(--alice-primary)"
                opacity={isHover ? 1 : fillOpacity(ratio)}
                stroke={isHover ? 'var(--alice-text)' : 'none'}
                strokeWidth={isHover ? 1.2 : 0}
              >
                <title>{confidential ? 'Amount hidden (confidential)' : formatAmount(c.valueSats, unit)}</title>
              </circle>
              {labelled && (
                <text
                  x={c.x}
                  y={c.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="var(--alice-bg)"
                  style={{ fontSize: Math.max(8, c.r * 0.34), fontWeight: 600, pointerEvents: 'none' }}
                >
                  {formatAmountShort(c.valueSats, unit)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.7 }}>
        {confidential
          ? 'Each circle is one unspent output; amounts are confidential on Liquid, so sizes are equal.'
          : 'Each circle is one unspent output; its size is the amount it holds.'}
        {capped && ` Showing the ${layout.shown} largest of ${utxos.length.toLocaleString('en-US')}.`}
      </p>
    </div>
  );
}
