'use client';

import { useMemo, useState } from 'react';
import type { BalancePoint } from '@/lib/explorer/balance-history';
import { formatAmountShort, formatAmount, useAmountState } from '@/components/AmountDisplay';

const RANGES: { label: string; seconds: number | null }[] = [
  { label: '3M', seconds: 90 * 86400 },
  { label: '1Y', seconds: 365 * 86400 },
  { label: '5Y', seconds: 5 * 365 * 86400 },
  { label: 'ALL', seconds: null },
];

const VW = 640;
const VH = 200;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 22;

function btc(sats: number): string {
  const b = sats / 1e8;
  if (b === 0) return '0';
  if (b < 0.001) return b.toFixed(6).replace(/0+$/, '');
  return b.toFixed(b < 1 ? 4 : 2);
}

function formatDate(sec: number): string {
  return new Date(sec * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Balance over time as a stepped area chart, with range buttons and a hover
// readout. The series is a step function (balance holds between transactions),
// drawn as filled area plus the line on top.
export function ExplorerBalanceChart({
  points,
  partial,
  noFiat = false,
}: {
  points: BalancePoint[];
  partial: boolean;
  /** Playground: valueless sats must never display as fiat. */
  noFiat?: boolean;
}) {
  const rawUnit = useAmountState();
  const unit = noFiat && rawUnit.format === 'usd' ? { ...rawUnit, format: 'symbol' as const } : rawUnit;
  const [rangeIdx, setRangeIdx] = useState(RANGES.length - 1); // default ALL
  const [hoverX, setHoverX] = useState<number | null>(null);

  const view = useMemo(() => {
    if (points.length < 2) return null;
    const now = points[points.length - 1].t;
    const rangeSec = RANGES[rangeIdx].seconds;
    const minT = rangeSec == null ? points[0].t : Math.max(points[0].t, now - rangeSec);

    // Keep points inside the window, and carry the balance in at the left edge.
    const inside = points.filter(p => p.t >= minT);
    const before = [...points].reverse().find(p => p.t < minT);
    const windowed: BalancePoint[] = [];
    if (before) windowed.push({ t: minT, balanceSats: before.balanceSats });
    else if (inside.length && inside[0].t > minT) windowed.push({ t: minT, balanceSats: inside[0].balanceSats });
    windowed.push(...inside);
    if (windowed.length < 2) return null;

    const t0 = windowed[0].t;
    const t1 = windowed[windowed.length - 1].t;
    const maxBal = Math.max(1, ...windowed.map(p => p.balanceSats));
    const sx = (t: number) => PAD_L + ((t - t0) / Math.max(1, t1 - t0)) * (VW - PAD_L - PAD_R);
    const sy = (b: number) => PAD_T + (1 - b / maxBal) * (VH - PAD_T - PAD_B);

    // Stepped path: hold each balance until the next transaction time.
    let line = `M ${sx(windowed[0].t).toFixed(1)} ${sy(windowed[0].balanceSats).toFixed(1)}`;
    for (let i = 1; i < windowed.length; i++) {
      const x = sx(windowed[i].t).toFixed(1);
      line += ` L ${x} ${sy(windowed[i - 1].balanceSats).toFixed(1)} L ${x} ${sy(windowed[i].balanceSats).toFixed(1)}`;
    }
    const area = `${line} L ${sx(t1).toFixed(1)} ${sy(0).toFixed(1)} L ${sx(t0).toFixed(1)} ${sy(0).toFixed(1)} Z`;

    return { windowed, t0, t1, maxBal, sx, sy, line, area };
  }, [points, rangeIdx]);

  const hover = useMemo(() => {
    if (!view || hoverX == null) return null;
    // Map cursor x back to a time, find the balance in effect then.
    const frac = (hoverX - PAD_L) / (VW - PAD_L - PAD_R);
    const t = view.t0 + frac * (view.t1 - view.t0);
    let bal = view.windowed[0].balanceSats;
    for (const p of view.windowed) { if (p.t <= t) bal = p.balanceSats; else break; }
    return { t, bal, x: view.sx(t), y: view.sy(bal) };
  }, [view, hoverX]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>BALANCE</span>
        <div className="flex gap-1">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setRangeIdx(i)}
              className="font-pixel tracking-widest cursor-pointer"
              style={{
                fontSize: 10, padding: '4px 8px', borderRadius: 2,
                border: `1px solid ${i === rangeIdx ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
                backgroundColor: 'transparent',
                color: i === rangeIdx ? 'var(--alice-primary)' : 'var(--alice-muted)',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!view ? (
        <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
          Not enough history in this range to chart.
        </p>
      ) : (
        <div style={{ border: '1px solid var(--alice-border)', borderRadius: 2, position: 'relative' }}>
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            width="100%"
            style={{ display: 'block' }}
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              setHoverX(((e.clientX - rect.left) / rect.width) * VW);
            }}
            onMouseLeave={() => setHoverX(null)}
          >
            <defs>
              <linearGradient id="rh-bal-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8bb8ff" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#8bb8ff" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={view.area} fill="url(#rh-bal-fill)" />
            <path d={view.line} fill="none" stroke="#8bb8ff" strokeWidth={1.5} />
            {/* Max balance label. */}
            <text x={PAD_L} y={PAD_T} fontSize={9} fill="var(--alice-muted)">{formatAmountShort(view.maxBal, unit)}</text>
            {/* Date range. */}
            <text x={PAD_L} y={VH - 6} fontSize={9} fill="var(--alice-muted)">{formatDate(view.t0)}</text>
            <text x={VW - PAD_R} y={VH - 6} fontSize={9} fill="var(--alice-muted)" textAnchor="end">{formatDate(view.t1)}</text>
            {hover && (
              <>
                <line x1={hover.x} y1={PAD_T} x2={hover.x} y2={VH - PAD_B} stroke="var(--alice-muted)" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={hover.x} cy={hover.y} r={3} fill="#8bb8ff" />
              </>
            )}
          </svg>
          {hover && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${Math.min(85, (hover.x / VW) * 100)}%`, top: 6,
                padding: '4px 8px', border: '1px solid var(--alice-border)', borderRadius: 2,
                backgroundColor: 'var(--alice-bg)', zIndex: 10,
              }}
            >
              <div className="font-numbers" style={{ fontSize: 11, color: 'var(--alice-text)' }}>{formatAmount(hover.bal, unit)}</div>
              <div className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{formatDate(hover.t)}</div>
            </div>
          )}
        </div>
      )}

      {partial && (
        <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.7 }}>
          Only recent transactions were loaded, so the chart shows the recent trajectory.
        </p>
      )}
    </div>
  );
}
