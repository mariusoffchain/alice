'use client';

// The transaction bowtie diagram: inputs converge from the left, outputs fan
// out to the right, ribbon thickness is value. Hovering a ribbon emphasises it
// (a bright stop slides into its gradient) instead of dimming the rest. Spent
// outputs grow a chevron connector that opens the spending transaction, and
// non-coinbase inputs one that opens the previous transaction.
//
// Adapted from mempool/mempool (https://github.com/mempool/mempool),
// frontend/src/app/components/tx-bowtie-graph/ (.html and .scss templates),
// (c) Mempool Space K.K. and contributors, licensed AGPL-3.0 - the same
// license as this project. Colors changed to the Alice palette.

import { useId, useMemo, useRef, useState } from 'react';
import { computeBowtie, type BowtieLine } from '@/lib/explorer/bowtie';
import { formatAmount, useAmountState } from '@/components/AmountDisplay';
import type { NormalizedOutspend, NormalizedTransaction } from '@/lib/explorer/types';

// Gradient anchors: G0 at the outer edges, G1 at the knot, G2 the transparent
// fade for connectors. HOT is the hover emphasis stop: the theme's text color,
// so the hovered ribbon brightens on a dark theme and deepens on a light one.
const G0 = '#8bb8ff';
const G1 = '#7b7bf0';
const G2 = 'rgba(139, 184, 255, 0)';
const FLAG = 'var(--alice-warning)';
const HOT = 'var(--alice-text)';

type Side = 'input' | 'output';
type Hover = { side: Side; index: number; connector: boolean };

function lineLabel(n: BowtieLine): string {
  if (n.kind === 'fee') return 'Miner fee';
  if (n.aggregateCount > 0) return `${n.aggregateCount} more ${n.kind === 'input' ? 'inputs' : 'outputs'}`;
  if (n.isCoinbase) return 'Coinbase (newly minted)';
  if (n.address) return n.address;
  if (n.scriptType && n.scriptType !== 'unknown') return `No address (${n.scriptType.toUpperCase()})`;
  return 'Unknown script';
}

export function ExplorerTxGraph({
  tx,
  flaggedAddresses,
  outspends,
  onOpenTx,
  onOpenAddress,
}: {
  tx: NormalizedTransaction;
  flaggedAddresses?: ReadonlySet<string>;
  /** Spend status per vout; undefined while unknown/loading. */
  outspends?: readonly NormalizedOutspend[];
  /** Opens another transaction (connector clicks). */
  onOpenTx?: (txid: string) => void;
  /** Opens an address (clicking a ribbon that has one). */
  onOpenAddress?: (address: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const unit = useAmountState();
  const [hover, setHover] = useState<Hover | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0, w: 0 });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const layout = useMemo(() => computeBowtie(tx, { expanded }), [tx, expanded]);

  // Namespace every SVG id so several graphs can coexist in the DOM.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gid = (name: string) => `rh${uid}-${name}`;
  const url = (name: string) => `url(#${gid(name)})`;

  const active: BowtieLine | null = hover
    ? (hover.side === 'input' ? layout.inputs : layout.outputs)[hover.index] ?? null
    : null;

  const isFlagged = (n: BowtieLine) => !!(n.address && flaggedAddresses?.has(n.address));
  const outspendOf = (n: BowtieLine): NormalizedOutspend | undefined =>
    n.kind === 'output' && n.originalIndex >= 0 ? outspends?.[n.originalIndex] : undefined;

  function strokeFor(n: BowtieLine, side: Side, hovered: boolean): string {
    if (n.zeroValue) return hovered ? HOT : G0;
    if (n.kind === 'fee') return hovered ? url('fee-hover') : url('fee');
    const s = side === 'input' ? 'in' : 'out';
    if (hovered) return url(`${s}-hover`);
    if (isFlagged(n)) return url(`${s}-flag`);
    return url(`${s}`);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width });
  }

  function renderSide(lines: BowtieLine[], side: Side) {
    return lines.map((n, i) => {
      const hovered = hover?.side === side && hover.index === i;
      const outspend = outspendOf(n);
      const showConnector = side === 'input'
        ? !!n.connectorPath && !!n.prevTxid
        : !!n.connectorPath && outspend?.spent === true;
      const connectorTarget = side === 'input' ? n.prevTxid : outspend?.txid;
      const enter = (connector: boolean) => () => setHover({ side, index: i, connector });
      const leave = () => setHover(null);
      const s = side === 'input' ? 'in' : 'out';
      const addrTarget = n.address && onOpenAddress ? n.address : undefined;

      return (
        <g key={`${side}-${i}`}>
          {showConnector && (
            <path
              d={n.connectorPath}
              fill={hovered && hover?.connector ? url(`${s}-conn-hover`) : url(`${s}-conn`)}
              stroke="none"
              opacity={0.75}
              style={{ cursor: connectorTarget && onOpenTx ? 'pointer' : 'default' }}
              onPointerEnter={enter(true)}
              onPointerLeave={leave}
              onClick={() => { if (connectorTarget) onOpenTx?.(connectorTarget); }}
            />
          )}
          {n.markerPath && (
            <path
              d={n.markerPath}
              fill="transparent"
              stroke="none"
              onPointerEnter={enter(false)}
              onPointerLeave={leave}
            />
          )}
          <path
            d={n.path}
            fill="none"
            stroke={strokeFor(n, side, hovered)}
            strokeWidth={n.thickness}
            strokeLinecap={n.zeroValue ? 'round' : 'butt'}
            markerStart={!n.zeroValue && n.kind !== 'fee' ? url(`arrow-${s}`) : undefined}
            style={{ cursor: addrTarget ? 'pointer' : 'default' }}
            onPointerEnter={enter(false)}
            onPointerLeave={leave}
            onClick={() => { if (addrTarget) onOpenAddress?.(addrTarget); }}
          />
        </g>
      );
    });
  }

  // Tooltip placement: follow the cursor, flip to the left half near the edge.
  const tipOnLeft = pointer.w > 0 && pointer.x > pointer.w * 0.55;

  return (
    <div className="flex flex-col gap-2">
      <div ref={wrapRef} className="relative w-full" onPointerMove={handlePointerMove}>
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height + 10}`}
          width="100%"
          style={{ display: 'block' }}
          role="img"
          aria-label="Transaction flow diagram"
        >
          <defs>
            <marker id={gid('arrow-in')} viewBox="-5 -5 10 10" refX={0} refY={0} markerUnits="strokeWidth" markerWidth={1.5} markerHeight={1} orient="auto">
              <path d="M -5 -5 L 0 0 L -5 5 L 1 5 L 1 -5 Z" strokeWidth={0} fill={G0} />
            </marker>
            <marker id={gid('arrow-out')} viewBox="-5 -5 10 10" refX={0} refY={0} markerUnits="strokeWidth" markerWidth={1.5} markerHeight={1} orient="auto">
              <path d="M 1 -5 L 0 -5 L -5 0 L 0 5 L 1 5 Z" strokeWidth={0} fill={G0} />
            </marker>

            <linearGradient id={gid('in')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G0} />
              <stop offset="100%" stopColor={G1} />
            </linearGradient>
            <linearGradient id={gid('out')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G1} />
              <stop offset="100%" stopColor={G0} />
            </linearGradient>
            <linearGradient id={gid('in-hover')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G0} />
              <stop offset="2%" stopColor={G0} />
              <stop offset="30%" stopColor={HOT} />
              <stop offset="100%" stopColor={G1} />
            </linearGradient>
            <linearGradient id={gid('out-hover')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G1} />
              <stop offset="70%" stopColor={HOT} />
              <stop offset="98%" stopColor={G0} />
              <stop offset="100%" stopColor={G0} />
            </linearGradient>
            <linearGradient id={gid('in-flag')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G0} />
              <stop offset="2%" stopColor={G0} />
              <stop offset="30%" stopColor={FLAG} />
              <stop offset="100%" stopColor={G1} />
            </linearGradient>
            <linearGradient id={gid('out-flag')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G1} />
              <stop offset="70%" stopColor={FLAG} />
              <stop offset="98%" stopColor={G0} />
              <stop offset="100%" stopColor={G0} />
            </linearGradient>
            <linearGradient id={gid('in-conn')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G2} />
              <stop offset="80%" stopColor={G0} />
            </linearGradient>
            <linearGradient id={gid('out-conn')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="20%" stopColor={G0} />
              <stop offset="100%" stopColor={G2} />
            </linearGradient>
            <linearGradient id={gid('in-conn-hover')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={HOT} />
              <stop offset="80%" stopColor={G0} />
            </linearGradient>
            <linearGradient id={gid('out-conn-hover')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="20%" stopColor={G0} />
              <stop offset="100%" stopColor={HOT} />
            </linearGradient>
            <linearGradient id={gid('fee')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G1} />
              <stop offset="50%" stopColor={G1} />
              <stop offset="100%" stopColor={G2} />
            </linearGradient>
            <linearGradient id={gid('fee-hover')} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={G1} />
              <stop offset="100%" stopColor={HOT} />
            </linearGradient>
          </defs>

          {layout.hasLine && (
            <path
              d={layout.middle.path}
              fill="none"
              stroke={G1}
              strokeWidth={layout.middle.strokeWidth}
            />
          )}
          {renderSide(layout.inputs, 'input')}
          {renderSide(layout.outputs, 'output')}
        </svg>

        {active && (
          <div
            style={{
              position: 'absolute',
              top: pointer.y + 14,
              ...(tipOnLeft ? { right: pointer.w - pointer.x + 14 } : { left: pointer.x + 14 }),
              maxWidth: 280,
              padding: '8px 10px',
              border: '1px solid var(--alice-border)',
              borderRadius: 2,
              backgroundColor: 'var(--alice-bg-soft)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <p className="font-pixel tracking-widest m-0" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
              {active.kind === 'fee' ? 'FEE' : active.kind === 'input' ? 'INPUT' : 'OUTPUT'}
            </p>
            <p className="font-numbers m-0 break-all" style={{ fontSize: 12, color: 'var(--alice-text)' }}>
              {lineLabel(active)}
            </p>
            {typeof active.valueSats === 'number' && (
              <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-text)' }}>
                {/* The fee ribbon stays in sats; coin values follow the unit. */}
                {active.kind === 'fee'
                  ? `${active.valueSats.toLocaleString('en-US')} sats`
                  : formatAmount(active.valueSats, unit)}
              </p>
            )}
            {active.confidential && (
              <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
                Amount hidden (confidential)
              </p>
            )}
            {isFlagged(active) && (
              <p className="font-numbers m-0" style={{ fontSize: 11, color: FLAG }}>
                Flagged by privacy analysis
              </p>
            )}
            {active.kind === 'output' && active.originalIndex >= 0 && outspends && (
              <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>
                {outspendOf(active)?.spent
                  ? hover?.connector ? 'Open the spending transaction' : 'Spent - the edge chevron opens the next tx'
                  : 'Unspent'}
              </p>
            )}
            {active.kind === 'input' && hover?.connector && active.prevTxid && (
              <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>
                Open the previous transaction
              </p>
            )}
            {active.address && onOpenAddress && !hover?.connector && (
              <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-primary)' }}>
                Click to open this address
              </p>
            )}
          </div>
        )}
      </div>

      <p
        className="font-numbers m-0"
        style={{ fontSize: 12, color: 'var(--alice-muted)', textAlign: 'center' }}
      >
        {layout.totalInputs} input(s) into {layout.totalOutputs} output(s). Hover a ribbon for detail.
      </p>

      {layout.truncatable && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="font-pixel tracking-widest self-center cursor-pointer"
          style={{
            fontSize: 10,
            padding: '7px 14px',
            border: '2px solid var(--alice-border)',
            borderRadius: 2,
            backgroundColor: 'transparent',
            color: 'var(--alice-primary)',
          }}
        >
          {expanded
            ? 'SHOW FEWER'
            : `SHOW ALL ${Math.max(layout.totalInputs, layout.totalOutputs)} ENTRIES`}
        </button>
      )}
    </div>
  );
}
