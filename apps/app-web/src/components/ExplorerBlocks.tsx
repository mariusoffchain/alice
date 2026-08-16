'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChainDataProvider } from '@/lib/explorer/provider';
import type { NormalizedBlock, ProjectedBlock, RibbonFocus } from '@/lib/explorer/types';
import { feeColor, formatBlockAgeOrDate, formatDateTime, formatFeeRange } from '@/lib/explorer/blocks';

const POLL_MS = 20_000;
const BLOCK_W = 122;

function ConfirmedBlock({ block, now, focused, marked, markColor, markTextColor, onClick }: {
  block: NormalizedBlock;
  now: number;
  focused: boolean;
  /** True when this block carries a highlighted transaction (an Arkade
   *  settlement); it gets the highlight colour's border and a small marker. */
  marked?: boolean;
  markColor?: string;
  /** Legible variant of markColor for the small marker text. */
  markTextColor?: string;
  onClick: () => void;
}) {
  const color = feeColor(block.medianFee);
  const range = formatFeeRange(block.feeRange);
  return (
    <button
      type="button"
      onClick={onClick}
      data-block-height={block.height}
      className="shrink-0 text-left cursor-pointer"
      style={{
        width: BLOCK_W,
        padding: '8px 10px',
        border: `1px solid ${marked && markColor ? markColor : 'var(--alice-border)'}`,
        borderTop: `3px solid ${marked && markColor ? markColor : color}`,
        borderRadius: 2,
        // The focus highlight is a ring plus a background, never the border, so
        // no shorthand/longhand border property changes across a rerender.
        backgroundColor: focused ? 'var(--alice-bg)' : 'var(--alice-bg-soft)',
        boxShadow: focused ? '0 0 0 2px var(--alice-primary)' : undefined,
      }}
      title={`Block ${block.height} - ${block.poolName ?? 'unknown pool'} - ${formatDateTime(block.timestamp)}${marked ? ' - contains an Arkade settlement' : ''}`}
    >
      <div className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-text)' }}>
        {block.height.toLocaleString('en-US')}
      </div>
      <div className="font-numbers" style={{ fontSize: 12, color, marginTop: 3 }}>
        {block.medianFee !== undefined ? `~${Math.round(block.medianFee)} sat/vB` : 'n/a'}
      </div>
      {range && <div className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{range}</div>}
      <div className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)', marginTop: 3 }}>
        {block.txCount.toLocaleString('en-US')} tx
      </div>
      {/* Fresh blocks read as an age; a week or older, the numeric date says
          more than a big "ago" count. Hover for the exact moment. */}
      <div className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)', opacity: 0.7 }}>
        {formatBlockAgeOrDate(block.timestamp, now)}
      </div>
      {marked && (
        <div className="font-pixel tracking-widest" style={{ fontSize: 6, color: markTextColor ?? markColor, marginTop: 3 }}>
          TX SETTLEMENT
        </div>
      )}
    </button>
  );
}

function PendingBlock({ block, index, focused }: { block: ProjectedBlock; index: number; focused: boolean }) {
  const color = feeColor(block.medianFee);
  const range = formatFeeRange(block.feeRange);
  const eta = index === 0 ? 'NEXT BLOCK' : `IN ~${(index + 1) * 10} MIN`;
  return (
    <div
      className="shrink-0"
      data-pending-index={index}
      style={{
        width: BLOCK_W,
        padding: '8px 10px',
        border: '1px dashed var(--alice-border)',
        borderTop: `3px solid ${color}`,
        borderRadius: 2,
        backgroundColor: focused ? 'var(--alice-bg)' : undefined,
        boxShadow: focused ? '0 0 0 2px var(--alice-primary)' : undefined,
      }}
      title={focused ? 'This transaction is expected in this projected block' : 'Projected block, still in the mempool'}
    >
      <div className="font-pixel" style={{ fontSize: 8, color: 'var(--alice-muted)' }}>{eta}</div>
      <div className="font-numbers" style={{ fontSize: 12, color, marginTop: 3 }}>~{Math.round(block.medianFee)} sat/vB</div>
      {range && <div className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{range}</div>}
      <div className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)', marginTop: 3 }}>
        {block.txCount.toLocaleString('en-US')} tx
      </div>
    </div>
  );
}

// A break between two non-contiguous stretches of chain (the live tip and an
// old block's neighbourhood), so the gap reads as "blocks not shown" rather than
// a wrong, jumped sequence.
function GapChip({ delta }: { delta: number }) {
  const label = delta > 999 ? `${Math.round(delta / 1000)}K` : String(delta);
  return (
    <div
      className="shrink-0 flex flex-col items-center justify-center px-1"
      style={{ minWidth: 34 }}
      title={`${delta.toLocaleString('en-US')} block${delta > 1 ? 's' : ''} not shown`}
    >
      <span className="font-numbers" style={{ fontSize: 16, lineHeight: '16px', color: 'var(--alice-muted)' }}>⋯</span>
      <span className="font-pixel tracking-widest" style={{ fontSize: 6, color: 'var(--alice-muted)', opacity: 0.7, marginTop: 2 }}>{label}</span>
    </div>
  );
}

// Merge a fresh batch into the existing list by height, newest first, so polling
// adds new blocks at the head without wiping older blocks the user paged in.
function mergeBlocks(existing: NormalizedBlock[], incoming: NormalizedBlock[]): NormalizedBlock[] {
  const byHeight = new Map<number, NormalizedBlock>();
  for (const b of existing) byHeight.set(b.height, b);
  for (const b of incoming) byHeight.set(b.height, b);
  return [...byHeight.values()].sort((a, b) => b.height - a.height);
}

type Orientation = 'confirmed-right' | 'confirmed-left';

// The live "blockchain": full width, mempool blocks and confirmed blocks meeting
// at a central divider, scrollable, with a button to flip which side is which.
// Polls every 20s. Renders nothing when the provider has no blocks endpoint.
export function ExplorerBlocks({
  provider,
  onOpenBlock,
  focus,
  highlight,
}: {
  provider: ChainDataProvider;
  onOpenBlock: (height: string) => void;
  /** What to spotlight: a confirmed block by height, or the projected block an
   *  unconfirmed transaction is expected in. Absent means centre on the divider. */
  focus?: RibbonFocus;
  /** Blocks to mark permanently (on Arkade: the ones carrying a settlement),
   *  with the accent colour they get. Independent of the focus spotlight.
   *  `ensureHeight` asks the ribbon to auto-page older blocks until the window
   *  reaches that height, so the marked blocks are actually on screen (the
   *  chain tip alone rarely contains a settlement). `textColor` is the legible
   *  variant used for small text where the fill colour would vanish. */
  highlight?: { heights: ReadonlySet<number>; color: string; textColor?: string; ensureHeight?: number };
}) {
  const [blocks, setBlocks] = useState<NormalizedBlock[]>([]);
  const [pending, setPending] = useState<ProjectedBlock[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [errored, setErrored] = useState(false);
  const [orientation, setOrientation] = useState<Orientation>('confirmed-right');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [ready, setReady] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  // Focus heights we have already fetched a neighbourhood for, so an old block
  // is loaded once and never re-requested on every poll.
  const neighbourhoodTried = useRef<Set<number>>(new Set());

  const supported = typeof provider.getRecentBlocks === 'function';

  // Which projected block an unconfirmed tx lands in: the first whose fee floor
  // its fee rate clears (mempool orders projected blocks highest-fee first), or
  // the last one if its fee is below them all.
  const pendingFocusIndex = (() => {
    if (focus?.kind !== 'pending' || pending.length === 0) return -1;
    const f = focus.feeRate;
    if (f == null) return 0;
    const i = pending.findIndex(p => p.feeRange.length > 0 && f >= p.feeRange[0]);
    return i === -1 ? pending.length - 1 : i;
  })();

  // Whether the spotlight target is currently on screen. Used to re-centre only
  // when it first appears (e.g. an old block's neighbourhood finishes loading),
  // never on every block list change, so paging older keeps the scroll put.
  const focusPresent = focus?.kind === 'height'
    ? blocks.some(b => b.height === focus.height)
    : focus?.kind === 'pending'
      ? pendingFocusIndex >= 0
      : true;

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const controller = new AbortController();
    // One poll at a time: when the endpoint stalls past the interval, ticks
    // must not pile a second (and third...) poll on top of the stuck one.
    let inFlight = false;
    async function poll() {
      if (inFlight) return;
      inFlight = true;
      try {
        const [b, p] = await Promise.all([
          provider.getRecentBlocks!(undefined, { signal: controller.signal }),
          provider.getMempoolBlocks
            ? provider.getMempoolBlocks({ signal: controller.signal })
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setBlocks(prev => mergeBlocks(prev, b));
        setPending(p);
        setNow(Math.floor(Date.now() / 1000));
        setErrored(false);
        setReady(true);
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        inFlight = false;
      }
    }
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; controller.abort(); clearInterval(id); };
  }, [provider, supported]);

  // Centre the viewport on first data and when the sides flip: on a block page,
  // on the focused block; otherwise on the pending/confirmed divider. Not on
  // polls, so the view never jumps under the user.
  useLayoutEffect(() => {
    if (!ready) return;
    const raf = requestAnimationFrame(() => {
      const sc = scrollRef.current;
      if (!sc) return;
      let target: HTMLElement | null;
      if (focus?.kind === 'height') {
        target = sc.querySelector<HTMLElement>(`[data-block-height="${focus.height}"]`);
      } else if (focus?.kind === 'pending' && pendingFocusIndex >= 0) {
        target = sc.querySelector<HTMLElement>(`[data-pending-index="${pendingFocusIndex}"]`);
      } else {
        target = dividerRef.current;
      }
      if (target) sc.scrollLeft = target.offsetLeft - sc.clientWidth / 2 + target.offsetWidth / 2;
    });
    return () => cancelAnimationFrame(raf);
  // Deliberately not on `blocks`: re-centre only when the target appears, so
  // loading older blocks or a new tip never yanks the view back to the start.
  }, [ready, orientation, focus, pendingFocusIndex, focusPresent]);

  // When the spotlighted confirmed block is older than the loaded window, pull a
  // small neighbourhood around it (roughly ten each side) so it shows in context
  // without loading the whole chain between here and there.
  useEffect(() => {
    if (focus?.kind !== 'height' || blocks.length === 0) return;
    const h = focus.height;
    if (blocks.some(b => b.height === h)) return;
    if (neighbourhoodTried.current.has(h)) return;
    if (typeof provider.getRecentBlocks !== 'function') return;
    neighbourhoodTried.current.add(h);
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const after = await provider.getRecentBlocks!(h + 10, { signal: controller.signal });
        const before = await provider.getRecentBlocks!(h - 5, { signal: controller.signal });
        if (!cancelled) setBlocks(prev => mergeBlocks(prev, [...after, ...before]));
      } catch { /* leave the ribbon as it is */ }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [focus, blocks, provider]);

  // Auto-extend the window down to highlight.ensureHeight (a handful of pages
  // at most, bounded), so the settlement-carrying blocks are reachable by a
  // scroll instead of hiding behind manual "older" clicks. Guarded by a ref,
  // not by state, so the effect never cancels its own fetch; a stale merge is
  // harmless (mergeBlocks is idempotent by height).
  const autoLoads = useRef(0);
  const autoLoadInFlight = useRef(false);
  useEffect(() => {
    const target = highlight?.ensureHeight;
    if (target === undefined || blocks.length === 0 || autoLoadInFlight.current) return;
    const oldest = blocks[blocks.length - 1].height;
    if (oldest <= target || autoLoads.current >= 8) return;
    if (typeof provider.getRecentBlocks !== 'function') return;
    autoLoads.current += 1;
    autoLoadInFlight.current = true;
    provider.getRecentBlocks(oldest - 1)
      .then(older => setBlocks(prev => mergeBlocks(prev, older)))
      .catch(() => { /* keep what is shown */ })
      .finally(() => { autoLoadInFlight.current = false; });
  }, [highlight?.ensureHeight, blocks, provider]);

  const loadOlder = useCallback(async () => {
    if (!provider.getRecentBlocks || loadingOlder || blocks.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = blocks[blocks.length - 1].height;
      const older = await provider.getRecentBlocks(oldest - 1);
      setBlocks(prev => mergeBlocks(prev, older));
    } catch { /* keep what is shown */ } finally {
      setLoadingOlder(false);
    }
  }, [provider, blocks, loadingOlder]);

  if (!supported) return null;

  // Jump to the newest settlement-carrying block loaded in the window (the
  // auto-extension above guarantees the latest ones are), centred smoothly.
  const latestMarked = highlight && highlight.heights.size > 0
    ? Math.max(...highlight.heights)
    : undefined;
  function jumpToLatestMarked() {
    if (latestMarked === undefined) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-block-height="${latestMarked}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  // The divider column must never outgrow the block cards, or every card in
  // the row stretches with it: with the settlement-jump button present, both
  // buttons shrink so the stacked pair stays within a card's height.
  const dividerBtn = latestMarked !== undefined ? 24 : 30;
  const Divider = (
    <div ref={dividerRef} className="shrink-0 flex flex-col items-center justify-center px-2" style={{ minWidth: 44 }}>
      <div style={{ width: 2, flex: 1, minHeight: 16, backgroundColor: 'var(--alice-border)' }} />
      <button
        type="button"
        onClick={() => setOrientation(o => (o === 'confirmed-right' ? 'confirmed-left' : 'confirmed-right'))}
        className="cursor-pointer my-1"
        style={{
          width: dividerBtn, height: dividerBtn, borderRadius: 2,
          border: '1px solid var(--alice-border)', backgroundColor: 'var(--alice-bg-soft)',
          color: 'var(--alice-primary)', fontSize: 12, lineHeight: '12px',
        }}
        aria-label="Swap confirmed and pending sides"
        title="Swap sides"
      >
        ⇄
      </button>
      {latestMarked !== undefined && (
        <button
          type="button"
          onClick={jumpToLatestMarked}
          className="cursor-pointer mb-1 flex items-center justify-center"
          style={{
            width: dividerBtn, height: dividerBtn, borderRadius: 2,
            border: `1px solid ${highlight!.color}`, backgroundColor: highlight!.color,
          }}
          aria-label="Jump to the latest settlement block"
          title={`Jump to the latest settlement (block ${latestMarked.toLocaleString('en-US')}): where Arkade last committed into Bitcoin`}
        >
          {/* An arrow sinking halfway into a square: the commitment landing
              inside a Bitcoin block. The square's top edge is split so the
              shaft visibly enters it. */}
          <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
            <g stroke="#ffffff" strokeWidth={1.8} fill="none">
              <path d="M3 6 H6 M10 6 H13 M3 6 V14 H13 V6" />
              <path d="M8 1 V11" />
              <path d="M5.2 8.6 L8 11.4 L10.8 8.6" />
            </g>
          </svg>
        </button>
      )}
      <div style={{ width: 2, flex: 1, minHeight: 16, backgroundColor: 'var(--alice-border)' }} />
    </div>
  );

  const LoadOlder = blocks.length > 0 ? (
    <button
      type="button"
      onClick={() => void loadOlder()}
      disabled={loadingOlder}
      className="shrink-0 font-pixel tracking-widest cursor-pointer disabled:cursor-not-allowed"
      style={{
        width: 64, borderRadius: 2, border: '1px dashed var(--alice-border)',
        backgroundColor: 'transparent', color: 'var(--alice-muted)', fontSize: 7,
        opacity: loadingOlder ? 0.5 : 1,
      }}
      aria-label="Load older blocks"
    >
      {loadingOlder ? '...' : 'OLDER +'}
    </button>
  ) : null;

  const pendingCards = pending.map((p, i) => (
    <PendingBlock key={`p${p.medianFee}-${i}`} block={p} index={i} focused={i === pendingFocusIndex} />
  ));

  // Confirmed cards, newest first, with a break inserted wherever two adjacent
  // cards are not consecutive heights (the live tip and an old neighbourhood).
  const confirmedCards: React.ReactNode[] = [];
  blocks.forEach((b, i) => {
    confirmedCards.push(
      <ConfirmedBlock
        key={b.id}
        block={b}
        now={now}
        focused={focus?.kind === 'height' && b.height === focus.height}
        marked={highlight?.heights.has(b.height)}
        markColor={highlight?.color}
        markTextColor={highlight?.textColor}
        onClick={() => onOpenBlock(String(b.height))}
      />,
    );
    const next = blocks[i + 1];
    if (next) {
      const gap = b.height - next.height - 1;
      if (gap > 0) confirmedCards.push(<GapChip key={`gap-${b.height}`} delta={gap} />);
    }
  });

  // Reading order left -> right, with the divider between the two groups.
  const items = orientation === 'confirmed-right'
    ? [...[...pendingCards].reverse(), Divider, ...confirmedCards, LoadOlder]
    : [LoadOlder, ...[...confirmedCards].reverse(), Divider, ...pendingCards];

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between px-5">
        <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>LIVE BLOCKS</span>
        {errored && (
          <span className="font-numbers" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.7 }}>reconnecting...</span>
        )}
      </div>

      {blocks.length === 0 && !errored ? (
        // Item 9: skeleton block cards instead of a bare "Loading..." string.
        <div className="flex items-stretch gap-2 overflow-hidden px-5 pb-2" aria-label="Loading recent blocks">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rh-skeleton shrink-0" style={{ width: 92, height: 74, opacity: 1 - i * 0.12 }} />
          ))}
        </div>
      ) : (
        <div ref={scrollRef} className="flex items-stretch gap-2 overflow-x-auto px-5 pb-2">
          {items.map((node, i) => <div key={i} className="flex shrink-0">{node}</div>)}
        </div>
      )}
    </div>
  );
}
