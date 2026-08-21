'use client';

// The Arkade-specific pieces of the Explorer. Arkade settles on Bitcoin
// mainnet, so the network reuses the whole Bitcoin explorer (ribbon, block,
// transaction and address views on the ASP's Esplora mirror); what is Arkade's
// own is rendered by the sections here: the live settlements feed, the ASP
// parameters, the commitment-round overlay a settlement transaction gets, and
// the VTXO view an ark1… address opens. Everything comes from the public,
// CORS-open ASP gateway, straight from the browser.

import { useEffect, useState } from 'react';
import {
  ArkadeError, getArkadeAddressVtxos, getArkadeInfo, subscribeSettlements,
  type ArkadeAddressInfo, type ArkadeCommitment, type ArkadeInfo, type ArkadeVirtualTx, type ArkadeVtxo,
} from '@/lib/explorer/arkade';
import { noteSeenSettlement, settlementRegistry, type KnownSettlement } from '@/lib/explorer/arkade-onchain';
import { buildArkadeBalanceSeries, buildArkadeTxHistory, virtualTxOutspends, virtualTxToNormalized } from '@/lib/explorer/arkade-insights';
import { averageUtxoAge } from '@/lib/explorer/address-insights';
import { getNetwork } from '@/lib/explorer/networks';
import { formatDateTime } from '@/lib/explorer/blocks';
import { Amount } from '@/components/AmountDisplay';
import { Analyzing, Badge, EmptyState, Metric, SectionPanel, Skeleton, SkeletonLines } from '@/components/ExplorerUI';
import { ExplorerTxGraph } from '@/components/ExplorerTxGraph';
import { ExplorerBalanceChart } from '@/components/ExplorerBalanceChart';
import { ExplorerUtxoBubbles } from '@/components/ExplorerUtxoBubbles';

// How many settlements the overview lists at first: the registry's identified
// history, newest first, extended in real time by the ASP stream; a SHOW MORE
// button pages further into what has been identified.
const FEED_INITIAL = 5;
const FEED_STEP = 10;

/** The Arkade accent, shared by every settlement highlight in the explorer. */
export const ARKADE_ACCENT = getNetwork('arkade').color;
/** A lightened accent for SMALL TEXT on dark backgrounds, where the deep
 *  violet itself would be illegible. Fills keep the accent, text gets this. */
export const ARKADE_ACCENT_SOFT = '#9b86ff';

function agoLabel(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function shortHex(s: string, head = 10, tail = 8): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}
function fmtDuration(sec: number): string {
  if (!sec) return '-';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}
function fmtTime(sec?: number): string {
  if (!sec) return '-';
  return new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/** The settlement marker, identical wherever a commitment is pointed at.
 *  White text always: the fill is the deep Arkade violet in both themes, and
 *  any theme token here could land dark-on-dark. */
export function SettlementBadge({ children = 'ARKADE TX SETTLEMENT' }: { children?: React.ReactNode }) {
  return (
    <span
      className="font-pixel tracking-widest inline-flex items-center shrink-0"
      style={{
        fontSize: 10, lineHeight: 1, padding: '3px 6px', borderRadius: 2,
        border: `1px solid ${ARKADE_ACCENT}`, color: '#ffffff',
        backgroundColor: ARKADE_ACCENT, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function VtxoRow({ v, onOpenTx }: { v: ArkadeVtxo; onOpenTx?: (txid: string) => void }) {
  const spent = v.isSpent || v.isSwept;
  const anchor = v.commitmentTxids[0];
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderTop: '1px solid var(--alice-border)' }}>
      <div className="flex flex-col min-w-0">
        <span className="font-numbers truncate" style={{ fontSize: 12, color: 'var(--alice-text)' }} title={`${v.txid}:${v.vout}`}>{shortHex(v.txid, 12, 6)}:{v.vout}</span>
        <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
          {v.isPreconfirmed ? 'preconfirmed' : 'confirmed'}
          {v.expiresAt ? ` · expires ${fmtTime(v.expiresAt)}` : ''}
        </span>
        {anchor && (
          onOpenTx ? (
            <button
              type="button"
              // Register the anchor as a settlement first, so the tab opens
              // as a Bitcoin (on-chain) tab, not an Arkade one.
              onClick={() => { noteSeenSettlement(anchor); onOpenTx(anchor); }}
              className="font-numbers text-left cursor-pointer bg-transparent p-0"
              style={{ fontSize: 10, color: 'var(--alice-primary)' }}
              title="Open the on-chain settlement anchoring this VTXO"
            >
              anchored in {shortHex(anchor, 8, 6)}
            </button>
          ) : (
            <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>anchored in {shortHex(anchor, 8, 6)}</span>
          )
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {v.isSwept ? <Badge tone="neutral">SWEPT</Badge> : v.isSpent ? <Badge tone="neutral">SPENT</Badge> : null}
        <Amount sats={v.amountSats} style={{ fontSize: 12, color: spent ? 'var(--alice-muted)' : 'var(--alice-text)' }} />
      </div>
    </div>
  );
}

function AddressCard({ info, onOpenTx }: { info: ArkadeAddressInfo; onOpenTx?: (txid: string) => void }) {
  // The lists open short and page out on demand, like the on-chain view.
  const [txLimit, setTxLimit] = useState(FEED_INITIAL);
  const [vtxoLimit, setVtxoLimit] = useState(FEED_INITIAL);
  const nowSec = Math.floor(Date.now() / 1000);
  const spendable = info.vtxos.filter(v => !v.isSpent && !v.isSwept);
  // The same insights the on-chain address view computes: the balance over
  // time (from the VTXOs' lifecycles) and the age of the coins held.
  const history = buildArkadeBalanceSeries(info.vtxos, info.spendableSats);
  const txHistory = buildArkadeTxHistory(info.vtxos);
  const age = averageUtxoAge(spendable.map(v => ({ valueSats: v.amountSats, blockTime: v.createdAt })), nowSec);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 px-4 py-3" style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="primary">ARKADE ADDRESS</Badge>
          <span className="font-numbers break-all" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{info.address}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
          <Metric label="SPENDABLE" value={<Amount sats={info.spendableSats} style={{ fontSize: 14, color: 'var(--alice-text)' }} />} />
          <Metric label="SPENDABLE VTXOS" value={info.spendableCount.toLocaleString('en-US')} />
          <Metric label="TOTAL VTXOS" value={info.totalCount.toLocaleString('en-US')} />
          {age && <Metric label="AVG COIN AGE" value={age.days < 1 ? `${Math.round(age.days * 24)}h` : `${age.days.toFixed(1)}d`} />}
        </div>
      </div>

      {/* Balance over time, like the on-chain address view. Off-chain spends
          carry no timestamp of their own, so an undatable spend just shortens
          the left edge (the series stays exact at today's edge). */}
      {history.points.length >= 2 && (
        <ExplorerBalanceChart points={history.points} partial={history.partial} />
      )}

      {/* The spendable VTXOs as packed circles, the off-chain twin of the
          unspent-outputs view. */}
      {spendable.length > 0 && (
        <ExplorerUtxoBubbles
          utxos={spendable.map(v => ({ valueSats: v.amountSats, blockTime: v.createdAt }))}
          title="SPENDABLE VTXOS"
        />
      )}

      {/* The transaction history, reconstructed from the VTXOs' lifecycles:
          one row per Arkade transaction that touched the address, newest
          first, with its net effect. */}
      {txHistory.length > 0 && (
        <div className="flex flex-col" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: 'var(--alice-bg-soft)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>TRANSACTIONS</span>
            <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
              {Math.min(txLimit, txHistory.length).toLocaleString('en-US')} of {txHistory.length.toLocaleString('en-US')}
            </span>
          </div>
          {txHistory.slice(0, txLimit).map(e => (
            <button
              key={e.txid}
              type="button"
              onClick={() => onOpenTx?.(e.txid)}
              className="flex items-center justify-between gap-3 w-full text-left cursor-pointer bg-transparent px-3 py-2"
              style={{ borderTop: '1px solid var(--alice-border)' }}
              disabled={!onOpenTx}
            >
              <div className="flex flex-col min-w-0">
                <span className="font-numbers truncate" style={{ fontSize: 12, color: onOpenTx ? 'var(--alice-primary)' : 'var(--alice-text)' }} title={e.txid}>
                  {shortHex(e.txid, 12, 6)}
                </span>
                <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
                  {e.time !== undefined ? fmtTime(e.time) : 'time unknown'}
                </span>
              </div>
              <span className="font-numbers shrink-0 flex items-center gap-1" style={{ fontSize: 12, color: e.deltaSats >= 0 ? 'var(--alice-success)' : 'var(--alice-text)' }}>
                {e.deltaSats >= 0 ? '+' : '−'}
                <Amount sats={Math.abs(e.deltaSats)} style={{ fontSize: 12, color: 'inherit' }} />
              </span>
            </button>
          ))}
          {txLimit < txHistory.length && (
            <button
              type="button"
              onClick={() => setTxLimit(l => l + FEED_STEP)}
              className="font-pixel tracking-widest cursor-pointer"
              style={{
                fontSize: 10, padding: '8px 16px', borderTop: '1px solid var(--alice-border)',
                backgroundColor: 'transparent', color: 'var(--alice-primary)',
              }}
            >
              SHOW MORE
            </button>
          )}
        </div>
      )}

      {info.vtxos.length > 0 ? (
        <div className="flex flex-col" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: 'var(--alice-bg-soft)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>VTXOS</span>
            <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
              {Math.min(vtxoLimit, info.vtxos.length).toLocaleString('en-US')} of {info.vtxos.length.toLocaleString('en-US')}
            </span>
          </div>
          {info.vtxos.slice(0, vtxoLimit).map(v => <VtxoRow key={`${v.txid}:${v.vout}`} v={v} onOpenTx={onOpenTx} />)}
          {vtxoLimit < info.vtxos.length && (
            <button
              type="button"
              onClick={() => setVtxoLimit(l => l + FEED_STEP)}
              className="font-pixel tracking-widest cursor-pointer"
              style={{
                fontSize: 10, padding: '8px 16px', borderTop: '1px solid var(--alice-border)',
                backgroundColor: 'transparent', color: 'var(--alice-primary)',
              }}
            >
              SHOW MORE
            </button>
          )}
        </div>
      ) : (
        <EmptyState glyph="○" title="No VTXOs on this address" hint="This Arkade address holds no off-chain coins that the ASP knows about." />
      )}
    </div>
  );
}

/** The commitment-round card, shown by the settlement overlay and anywhere a
 *  round is inspected. `onOpenTx` renders the txid as a link; omit it on the
 *  transaction's own page. */
export function CommitmentCard({ c, onOpenTx }: { c: ArkadeCommitment; onOpenTx?: (txid: string) => void }) {
  const window = c.startedAt && c.endedAt ? c.endedAt - c.startedAt : undefined;
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-col gap-3 px-4 py-3"
        style={{ border: '1px solid var(--alice-border)', borderLeft: `3px solid ${ARKADE_ACCENT}`, borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <SettlementBadge>ARKADE COMMITMENT ROUND</SettlementBadge>
          {onOpenTx ? (
            <button
              type="button"
              onClick={() => { noteSeenSettlement(c.txid); onOpenTx(c.txid); }}
              className="font-numbers break-all text-left cursor-pointer bg-transparent"
              style={{ fontSize: 11, color: 'var(--alice-primary)' }}
              title="Open the on-chain transaction"
            >
              {c.txid}
            </button>
          ) : (
            <span className="font-numbers break-all" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{c.txid}</span>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
          <Metric label="INPUT" value={<Amount sats={c.totalInputAmountSats} style={{ fontSize: 13, color: 'var(--alice-text)' }} />} />
          <Metric label="INPUT VTXOS" value={c.totalInputVtxos.toLocaleString('en-US')} />
          <Metric label="OUTPUT" value={<Amount sats={c.totalOutputAmountSats} style={{ fontSize: 13, color: 'var(--alice-text)' }} />} />
          <Metric label="OUTPUT VTXOS" value={c.totalOutputVtxos.toLocaleString('en-US')} />
          <Metric label="STARTED" value={fmtTime(c.startedAt)} />
          <Metric label="ENDED" value={fmtTime(c.endedAt)} />
          {window !== undefined && <Metric label="DURATION" value={fmtDuration(window)} />}
          <Metric label="BATCHES" value={c.batches.length.toLocaleString('en-US')} />
        </div>
      </div>

      {c.batches.length > 0 && (
        <div className="flex flex-col" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: 'var(--alice-bg-soft)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>BATCHES</span>
            <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>{c.batches.length}</span>
          </div>
          {c.batches.map(b => (
            <div key={b.key} className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderTop: '1px solid var(--alice-border)' }}>
              <div className="flex flex-col min-w-0">
                <span className="font-numbers truncate" style={{ fontSize: 12, color: 'var(--alice-text)' }} title={b.key}>{shortHex(b.key, 14, 8)}</span>
                <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
                  {b.totalOutputVtxos.toLocaleString('en-US')} vtxo{b.totalOutputVtxos === 1 ? '' : 's'}
                  {b.expiresAt ? ` · expires ${fmtTime(b.expiresAt)}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {b.swept && <Badge tone="neutral">SWEPT</Badge>}
                <Amount sats={b.totalOutputAmountSats} style={{ fontSize: 12, color: 'var(--alice-text)' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Newest first: an entry without a height (just announced, unconfirmed) sorts
// above everything already mined.
function byNewest(a: KnownSettlement, b: KnownSettlement): number {
  return (b.height ?? Number.MAX_SAFE_INTEGER) - (a.height ?? Number.MAX_SAFE_INTEGER);
}

/**
 * The settlements panel of the Arkade overview: the on-chain settlement
 * history this browser has identified (the chain walker fills it), extended in
 * real time by the ASP stream. Each row opens the settlement's on-chain
 * transaction tab, where the round's detail overlays the raw view.
 */
export function ArkadeLiveSettlements({ apiBaseUrl, onOpenTx }: { apiBaseUrl: string; onOpenTx: (txid: string) => void }) {
  const [known, setKnown] = useState<KnownSettlement[]>(() => [...settlementRegistry.all()].sort(byNewest));
  const [live, setLive] = useState(false);
  const [limit, setLimit] = useState(FEED_INITIAL);

  // Mirror the registry: the walker and the live stream both land there.
  useEffect(() => settlementRegistry.subscribe(() => {
    setKnown([...settlementRegistry.all()].sort(byNewest));
  }), []);

  // The live stream has no history of its own; it feeds the registry, which
  // notifies the mirror above. Reconnects with a short backoff when dropped.
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    setLive(false);
    (async () => {
      while (!stopped) {
        try {
          setLive(true);
          await subscribeSettlements(apiBaseUrl, s => noteSeenSettlement(s.txid), { signal: controller.signal });
        } catch {
          /* dropped or unreachable: fall through to backoff and retry */
        }
        setLive(false);
        if (stopped) break;
        await new Promise(r => setTimeout(r, 3000));
      }
    })();
    return () => { stopped = true; controller.abort(); };
  }, [apiBaseUrl]);

  const shown = known.slice(0, limit);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>ON-CHAIN SETTLEMENTS</span>
        <span className="flex items-center gap-1.5">
          <span style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: live ? 'var(--alice-success)' : 'var(--alice-muted)' }} />
          <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{live ? 'LIVE' : 'CONNECTING'}</span>
        </span>
      </div>
      <div className="flex flex-col" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
        {shown.length === 0 ? (
          <Analyzing label="identifying settlements on the Bitcoin chain…" />
        ) : (
          shown.map((s, i) => (
            <button
              key={s.txid}
              type="button"
              onClick={() => onOpenTx(s.txid)}
              className="flex items-center justify-between gap-3 w-full text-left cursor-pointer bg-transparent px-3 py-2"
              style={{ borderTop: i > 0 ? '1px solid var(--alice-border)' : undefined }}
            >
              <div className="flex flex-col min-w-0">
                <span className="font-numbers truncate" style={{ fontSize: 12, color: 'var(--alice-primary)' }} title={s.txid}>{shortHex(s.txid, 12, 8)}</span>
                <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
                  {s.height !== undefined ? `block ${s.height.toLocaleString('en-US')}` : 'in the mempool'}
                  {s.timestamp !== undefined ? ` · ${agoLabel(s.timestamp * 1000)} · ${formatDateTime(s.timestamp)}` : ''}
                </span>
              </div>
              <SettlementBadge />
            </button>
          ))
        )}
      </div>
      {known.length > shown.length && (
        <button
          type="button"
          onClick={() => setLimit(l => l + FEED_STEP)}
          className="font-pixel tracking-widest self-center cursor-pointer"
          style={{
            fontSize: 10, padding: '8px 16px', border: '2px solid var(--alice-border)',
            borderRadius: 2, backgroundColor: 'transparent', color: 'var(--alice-primary)',
          }}
        >
          SHOW {Math.min(FEED_STEP, known.length - shown.length)} MORE
        </button>
      )}
    </div>
  );
}

/** The ASP's advertised parameters, as a section of the Arkade overview. */
export function ArkadeAspInfo({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [info, setInfo] = useState<ArkadeInfo | null>(null);
  const [infoErr, setInfoErr] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setInfo(null); setInfoErr('');
    getArkadeInfo(apiBaseUrl, { signal: controller.signal })
      .then(i => setInfo(i))
      .catch(e => {
        // A cancelled fetch (re-render/unmount) is not an error to show.
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setInfoErr(e instanceof ArkadeError ? e.message : 'Could not reach the ASP.');
      });
    return () => controller.abort();
  }, [apiBaseUrl]);

  return (
    <div className="flex flex-col gap-2">
      <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>SERVICE PROVIDER</span>
      {infoErr ? (
        <div className="flex flex-col gap-1 px-4 py-3" style={{ border: '1px solid var(--alice-danger)', borderRadius: 2 }}>
          <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-danger)' }}>ASP UNREACHABLE</span>
          <p className="font-numbers m-0" style={{ fontSize: 13, color: 'var(--alice-text)' }}>{infoErr}</p>
        </div>
      ) : info ? (
        <div className="flex flex-col gap-3 px-4 py-3" style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
            <Metric label="ROUND EVERY" value={fmtDuration(info.sessionDurationSec)} />
            <Metric label="DUST" value={<Amount sats={info.dustSats} style={{ fontSize: 13, color: 'var(--alice-text)' }} />} />
            <Metric label="VTXO MIN" value={<Amount sats={info.vtxoMinSats} style={{ fontSize: 13, color: 'var(--alice-text)' }} />} />
            <Metric label="VTXO MAX" value={<Amount sats={info.vtxoMaxSats} style={{ fontSize: 13, color: 'var(--alice-text)' }} />} />
            <Metric label="EXIT DELAY" value={`${info.unilateralExitDelay.toLocaleString('en-US')} blocks`} />
            <Metric label="MAX TX WEIGHT" value={info.maxTxWeight.toLocaleString('en-US')} />
            <Metric label="VERSION" value={info.version || '-'} />
            <Metric label="SETTLES ON" value={info.network || '-'} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>SIGNER PUBKEY</span>
            <span className="font-numbers break-all" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{info.signerPubkey || '-'}</span>
          </div>
          {info.forfeitAddress && (
            <div className="flex flex-col gap-1">
              <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>FORFEIT ADDRESS</span>
              <span className="font-numbers break-all" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{info.forfeitAddress}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="px-4 py-3" style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}>
          <SkeletonLines lines={3} />
        </div>
      )}
    </div>
  );
}

/**
 * The view a VIRTUAL (off-chain) Arkade transaction gets: the txid exists in
 * the ASP's indexer but not on Bitcoin, so instead of Esplora's "not found"
 * the tab shows the decoded transaction, what it spent, what it created, and
 * where each output stands (preconfirmed, settled, spent, its expiry).
 */
export function ArkadeVirtualTxCard({ vtx, onOpenTx }: { vtx: ArkadeVirtualTx; onOpenTx?: (txid: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-col gap-3 px-4 py-3"
        style={{ border: '1px solid var(--alice-border)', borderLeft: `3px solid ${ARKADE_ACCENT}`, borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <SettlementBadge>ARKADE VIRTUAL TX</SettlementBadge>
          <span className="font-numbers break-all" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{vtx.txid}</span>
        </div>
        <p className="font-numbers m-0" style={{ fontSize: 12.5, lineHeight: '18px', color: 'var(--alice-muted)' }}>
          This transaction lives off-chain, held by the Arkade service provider: it is not recorded
          on Bitcoin. Its outputs are VTXOs, each anchored on-chain by a settlement transaction.
        </p>
      </div>

      {/* The same flow graph an on-chain transaction gets, drawn from the
          decoded PSBT; spent outputs point at their checkpoint spender. */}
      <ExplorerTxGraph
        tx={virtualTxToNormalized(vtx, 'arkade')}
        outspends={virtualTxOutspends(vtx)}
        onOpenTx={onOpenTx}
      />

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 flex flex-col" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
          <div className="px-3 py-2" style={{ backgroundColor: 'var(--alice-bg-soft)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>INPUTS ({vtx.inputs.length})</span>
          </div>
          {vtx.inputs.map((inp, i) => (
            <div key={`${inp.txid}:${inp.vout}:${i}`} className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderTop: '1px solid var(--alice-border)' }}>
              {onOpenTx && inp.txid ? (
                <button
                  type="button"
                  onClick={() => onOpenTx(inp.txid)}
                  className="font-numbers truncate text-left cursor-pointer bg-transparent p-0"
                  style={{ fontSize: 12, color: 'var(--alice-primary)' }}
                  title={`${inp.txid}:${inp.vout}`}
                >
                  {shortHex(inp.txid, 12, 6)}:{inp.vout}
                </button>
              ) : (
                <span className="font-numbers truncate" style={{ fontSize: 12, color: 'var(--alice-text)' }} title={`${inp.txid}:${inp.vout}`}>{shortHex(inp.txid, 12, 6)}:{inp.vout}</span>
              )}
              {inp.amountSats !== undefined && <Amount sats={inp.amountSats} style={{ fontSize: 12, color: 'var(--alice-text)' }} />}
            </div>
          ))}
        </div>

        <div className="flex-1 flex flex-col" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
          <div className="px-3 py-2" style={{ backgroundColor: 'var(--alice-bg-soft)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>OUTPUTS ({vtx.outputs.length})</span>
          </div>
          {vtx.outputs.map(o => (
            <div key={o.index} className="flex items-center justify-between gap-3 px-3 py-2" style={{ borderTop: '1px solid var(--alice-border)' }}>
              <div className="flex flex-col min-w-0">
                <span className="font-numbers truncate" style={{ fontSize: 12, color: 'var(--alice-text)' }} title={o.scriptHex}>
                  #{o.index}{o.isAnchor ? ' · anchor' : ''}
                </span>
                {o.vtxo && (
                  <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
                    {o.vtxo.isSwept ? 'swept' : o.vtxo.isSpent ? 'spent' : o.vtxo.isPreconfirmed ? 'preconfirmed' : 'settled'}
                    {o.vtxo.expiresAt ? ` · expires ${fmtTime(o.vtxo.expiresAt)}` : ''}
                  </span>
                )}
                {o.vtxo?.commitmentTxids[0] && (
                  onOpenTx ? (
                    <button
                      type="button"
                      onClick={() => { noteSeenSettlement(o.vtxo!.commitmentTxids[0]); onOpenTx(o.vtxo!.commitmentTxids[0]); }}
                      className="font-numbers text-left cursor-pointer bg-transparent p-0"
                      style={{ fontSize: 10, color: 'var(--alice-primary)' }}
                      title="Open the on-chain settlement anchoring this VTXO"
                    >
                      anchored in {shortHex(o.vtxo.commitmentTxids[0], 8, 6)}
                    </button>
                  ) : (
                    <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>anchored in {shortHex(o.vtxo.commitmentTxids[0], 8, 6)}</span>
                  )
                )}
              </div>
              <Amount sats={o.amountSats} style={{ fontSize: 12, color: 'var(--alice-text)' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type AddressTabState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; info: ArkadeAddressInfo };

/**
 * The tab an ark1… address opens: the address's VTXOs and balance from the ASP
 * indexer, in the place an on-chain address tab would occupy. Off-chain coins,
 * not on-chain outputs; each VTXO links to the settlement anchoring it.
 */
export function ExplorerArkadeAddressTab({ apiBaseUrl, address, onOpenTx }: {
  apiBaseUrl: string;
  address: string;
  onOpenTx?: (txid: string) => void;
}) {
  const [state, setState] = useState<AddressTabState>({ kind: 'loading' });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    getArkadeAddressVtxos(apiBaseUrl, address, { signal: controller.signal })
      .then(info => setState({ kind: 'loaded', info }))
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({ kind: 'error', message: e instanceof ArkadeError ? e.message : 'Could not load this Arkade address.' });
      });
    return () => controller.abort();
  }, [apiBaseUrl, address, retryToken]);

  if (state.kind === 'loading') {
    // The page structure is laid out from the first paint (metrics, balance,
    // VTXO bubbles, lists) and the data swaps in place, like the on-chain tab.
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 px-4 py-3" style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}>
          <Skeleton width="60%" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
            {['SPENDABLE', 'SPENDABLE VTXOS', 'TOTAL VTXOS', 'AVG COIN AGE'].map(l => (
              <div key={l} className="flex flex-col gap-1">
                <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{l}</span>
                <Skeleton width="60%" />
              </div>
            ))}
          </div>
        </div>
        <SectionPanel title="BALANCE"><div className="px-3 py-3"><Skeleton height={110} /></div></SectionPanel>
        <SectionPanel title="SPENDABLE VTXOS">
          <div className="flex items-center justify-center gap-3 px-3 py-4">
            <Skeleton width={64} height={64} style={{ borderRadius: '50%' }} />
            <Skeleton width={40} height={40} style={{ borderRadius: '50%' }} />
            <Skeleton width={26} height={26} style={{ borderRadius: '50%' }} />
          </div>
        </SectionPanel>
        <SectionPanel title="TRANSACTIONS"><Analyzing label="reading VTXOs from the Arkade service provider…" /></SectionPanel>
        <SectionPanel title="VTXOS"><div className="px-3 py-3"><SkeletonLines lines={5} /></div></SectionPanel>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="flex flex-col gap-2 px-4 py-3" style={{ border: '1px solid var(--alice-danger)', borderRadius: 2 }}>
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-danger)' }}>COULD NOT LOAD</span>
        <p className="font-numbers m-0" style={{ fontSize: 13, color: 'var(--alice-text)' }}>{state.message}</p>
        <button
          type="button"
          onClick={() => setRetryToken(t => t + 1)}
          className="font-pixel tracking-widest self-start cursor-pointer"
          style={{
            fontSize: 10, padding: '8px 16px', border: '2px solid var(--alice-border)',
            borderRadius: 2, backgroundColor: 'transparent', color: 'var(--alice-primary)',
          }}
        >
          RETRY
        </button>
      </div>
    );
  }
  return <div className="rh-fade-in"><AddressCard info={state.info} onOpenTx={onOpenTx} /></div>;
}
