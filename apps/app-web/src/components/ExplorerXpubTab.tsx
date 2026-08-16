'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChainDataProvider, RequestOptions } from '@/lib/explorer/provider';
import { ChainDataError } from '@/lib/explorer/provider';
import { detectAddressReuseForAddress, renderSignalsIdentified, type PrivacySignal } from '@/lib/explorer/signals';
import type { FullContext } from '@/lib/explorer/ask-alice';
// Type-only: the heavy derivation library is dynamic-imported inside the
// effect, so it stays out of the page's first-load bundle.
import type { WalletDescriptor } from '@/lib/explorer/wallet-derive';
import { scanWallet, type DerivedAddress, type WalletScan, type WalletScanPartial } from '@/lib/explorer/wallet-scan';
import { loadWallets, updateSnapshot } from '@/lib/explorer/wallet-store';
import { buildWalletBalanceSeries, collectHistoryTxs, lastMovement, toSparkline, walletTxDelta, type BalanceSeries } from '@/lib/explorer/balance-history';
import { Amount } from '@/components/AmountDisplay';
import type { NormalizedTransaction } from '@/lib/explorer/types';
import { ExplorerUtxoBubbles } from '@/components/ExplorerUtxoBubbles';
import { ExplorerBalanceChart } from '@/components/ExplorerBalanceChart';
import { Analyzing, Badge, EmptyState, Metric, SectionPanel, Skeleton, SkeletonLines } from '@/components/ExplorerUI';
import { formatDateTime } from '@/lib/explorer/blocks';

// Bound the balance-history fetch so a busy wallet cannot fan out into hundreds
// of requests on the public endpoint.
const MAX_HISTORY_ADDRESSES = 20;
const MAX_HISTORY_TXS = 500;
// How many wallet transactions to reveal per "load more" step.
const TX_PAGE = 25;

function btc(sats: number): string {
  // Same rule as the shared formatter: at least two decimals, the trailing
  // zeros beyond them dropped.
  return `${(sats / 1e8).toFixed(8).replace(/(\.\d{2}\d*?)0+$/, '$1')} BTC`;
}
function shortAddr(a: string): string {
  return a.length > 24 ? `${a.slice(0, 12)}...${a.slice(-8)}` : a;
}
function shortTxid(t: string): string {
  return `${t.slice(0, 10)}...${t.slice(-8)}`;
}

// One wallet transaction: its net effect on the whole wallet (sum received on
// the wallet's addresses minus sum spent from them), signed, plus when it
// landed. Clicking it opens the full transaction view.
function WalletTxRow({ tx, addresses, onOpen }: {
  tx: NormalizedTransaction;
  addresses: ReadonlySet<string>;
  onOpen: () => void;
}) {
  const delta = walletTxDelta(tx, addresses);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center justify-between gap-3 w-full text-left cursor-pointer bg-transparent px-3 py-2"
      style={{ borderTop: '1px solid var(--alice-border)' }}
    >
      <div className="flex flex-col min-w-0">
        <span className="font-numbers truncate" style={{ fontSize: 12, color: 'var(--alice-primary)' }} title={tx.txid}>{shortTxid(tx.txid)}</span>
        <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
          {tx.status.confirmed ? `block ${tx.status.blockHeight?.toLocaleString('en-US')}` : 'unconfirmed'}
          {tx.status.blockTime ? ` - ${formatDateTime(tx.status.blockTime)}` : ''}
          {' - '}{tx.inputs.length} in / {tx.outputs.length} out
        </span>
      </div>
      <Amount sats={delta} signed style={{ fontSize: 12, color: delta >= 0 ? 'var(--alice-text)' : 'var(--alice-muted)', flexShrink: 0 }} />
    </button>
  );
}
const SCRIPT_LABEL: Record<string, string> = {
  p2pkh: 'Legacy (P2PKH)', p2sh: 'Nested SegWit (P2SH)', p2wpkh: 'Native SegWit (P2WPKH)',
  p2wsh: 'SegWit script (P2WSH)', p2tr: 'Taproot (P2TR)', multisig: 'Multisig', unknown: 'Descriptor',
};

function AddressRow({ a, onOpen }: { a: DerivedAddress; onOpen: () => void }) {
  const balance = Math.max(0, a.stats.fundedSum - a.stats.spentSum);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center justify-between gap-3 w-full text-left cursor-pointer bg-transparent px-3 py-2"
      style={{ borderTop: '1px solid var(--alice-border)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-pixel tracking-widest shrink-0" style={{ fontSize: 6, color: 'var(--alice-muted)' }}>
          {a.chain === 0 ? 'R' : 'C'}/{a.index}
        </span>
        <span className="font-numbers truncate" style={{ fontSize: 12, color: 'var(--alice-primary)' }} title={a.address}>
          {shortAddr(a.address)}
        </span>
        {a.stats.fundedCount > 1 && (
          <span className="font-pixel tracking-widest shrink-0" style={{ fontSize: 5, padding: '2px 4px', border: '1px solid #e0a060', borderRadius: 2, color: '#e0a060' }}>
            REUSED
          </span>
        )}
      </div>
      <Amount sats={balance} style={{ fontSize: 12, color: balance > 0 ? 'var(--alice-text)' : 'var(--alice-muted)', flexShrink: 0 }} />
    </button>
  );
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; descriptor: WalletDescriptor; scan: WalletScan };

export function ExplorerXpubTab({
  input,
  networkId,
  provider,
  onOpenAddress,
  onOpenTx,
  onSignals,
}: {
  input: string;
  networkId: string;
  provider: ChainDataProvider;
  onOpenAddress: (address: string) => void;
  onOpenTx: (txid: string) => void;
  onSignals?: (signals: PrivacySignal[], full?: FullContext) => void;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [progress, setProgress] = useState<{ scanned: number; used: number } | null>(null);
  // The parsed wallet and the scan-so-far: they let the whole dashboard paint
  // after the first scanned window and refresh window by window.
  const [parsed, setParsed] = useState<WalletDescriptor | null>(null);
  const [partial, setPartial] = useState<WalletScanPartial | null>(null);
  const [series, setSeries] = useState<BalanceSeries | null>(null);
  const [walletTxs, setWalletTxs] = useState<NormalizedTransaction[]>([]);
  const [txVisible, setTxVisible] = useState(TX_PAGE);
  const [txPartial, setTxPartial] = useState(false);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'done' | 'unsupported'>('idle');
  const onSignalsRef = useRef(onSignals);
  onSignalsRef.current = onSignals;
  // Aborts every in-flight request of this tab the moment it closes or its
  // inputs change, so an abandoned scan stops occupying the shared gate.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: 'loading' });
    setProgress(null);
    setParsed(null);
    setPartial(null);
    setSeries(null);
    setWalletTxs([]);
    setTxVisible(TX_PAGE);
    setTxPartial(false);
    setHistoryState('idle');

    (async () => {
      // The derivation library loads lazily, only when a wallet view opens.
      const derive = await import('@/lib/explorer/wallet-derive');
      if (cancelled) return;
      let descriptor: WalletDescriptor;
      try {
        descriptor = derive.parseWalletInput(input, derive.deriveNetworkFor(networkId));
      } catch (err) {
        if (!cancelled) setState({ kind: 'error', message: err instanceof derive.WalletInputError ? err.message : 'Could not read this wallet.' });
        return;
      }
      if (!cancelled) setParsed(descriptor);

      let scan: WalletScan;
      try {
        scan = await scanWallet(descriptor, provider, {
          includeUtxos: true,
          signal: controller.signal,
          onProgress: (p) => { if (!cancelled) setProgress(p); },
          onPartial: (p) => { if (!cancelled) setPartial(p); },
        });
      } catch (err) {
        if (cancelled || (err instanceof ChainDataError && err.code === 'aborted')) return;
        setState({ kind: 'error', message: 'Could not scan this wallet on-chain.' });
        return;
      }
      if (cancelled) return;
      setState({ kind: 'loaded', descriptor, scan });

      // Refresh the saved card's snapshot from the fuller scan, if this wallet
      // is one the user saved (matched by its input on this network).
      const saved = loadWallets().find(w => w.input === input.trim() && w.networkId === networkId);
      if (saved) {
        updateSnapshot(saved.id, {
          balanceSats: scan.balanceSats, usedCount: scan.usedCount, txTotal: scan.txTotal, scannedAt: Date.now(),
        });
      }

      // Feed Alice: reused addresses across the wallet, plus a de-identified
      // wallet-shape context. Names/values stay local; only the shape and the
      // reuse findings project.
      const reuse = [...scan.receive, ...scan.change].flatMap(a => detectAddressReuseForAddress(a.stats));
      const context: PrivacySignal = {
        id: `WALLET_CONTEXT:${descriptor.receive}`,
        ruleId: 'ADDRESS_CONTEXT',
        severity: 'info',
        confidence: 'certain',
        title: 'Wallet shape',
        detail: `${scan.usedCount} used address(es), ${scan.receive.length} receive and ${scan.change.length} change.`,
        subjects: [descriptor.kind === 'xpub' ? 'xpub' : 'descriptor'],
        evidence: {
          usedCount: scan.usedCount,
          receiveUsed: scan.receive.length,
          changeUsed: scan.change.length,
          reusedCount: reuse.length,
          scriptType: descriptor.scriptHint,
        },
      };
      const findings = renderSignalsIdentified(reuse);
      const summary = [
        `${descriptor.kind === 'xpub' ? 'Extended-key' : 'Descriptor'} wallet, ${SCRIPT_LABEL[descriptor.scriptHint] ?? descriptor.scriptHint}.`,
        `${scan.usedCount} used address(es), balance ${btc(scan.balanceSats)}.`,
        findings,
      ].filter(Boolean).join('\n\n');
      onSignalsRef.current?.([context, ...reuse], {
        description: summary,
        subjects: [{ kind: 'address', value: descriptor.receive }],
      });
      // The balance-over-time history is NOT fetched here: it starts only once
      // the scan has landed (see the effect below), as bulk traffic, so the
      // wallet dashboard always paints first and the heavy walk comes last.
    })();

    return () => { cancelled = true; controller.abort(); abortRef.current = null; };
  }, [input, networkId, provider]);

  // Balance history: fold the used addresses' transactions into one wallet
  // timeline. Bounded and cancellable; runs automatically after the scan.
  const loadHistory = useCallback(async () => {
    if (state.kind !== 'loaded') return;
    if (typeof provider.getAddressTxs !== 'function') { setHistoryState('unsupported'); return; }
    setHistoryState('loading');
    setTxPartial(false);
    const { descriptor, scan } = state;
    const getTxs = provider.getAddressTxs.bind(provider);
    // Bulk traffic, tied to the tab: closing it cancels the walk outright.
    const request: RequestOptions = { signal: abortRef.current?.signal, priority: 'bulk', timeoutMs: 8_000 };
    const usedAddrs = [...scan.receive, ...scan.change];
    const addrSet = new Set(usedAddrs.map(a => a.address));
    let all: NormalizedTransaction[];
    let partial: boolean;
    try {
      const walk = await collectHistoryTxs(getTxs, usedAddrs.map(a => a.address), MAX_HISTORY_ADDRESSES, MAX_HISTORY_TXS, request);
      all = walk.txs;
      partial = walk.partial;
    } catch (err) {
      if (err instanceof ChainDataError && err.code === 'aborted') return;
      throw err;
    }
    const built = buildWalletBalanceSeries(all, addrSet, scan.balanceSats);
    setSeries(built);
    // The same transaction can surface from several of the wallet's addresses;
    // dedupe by txid and show newest first (unconfirmed on top).
    const byId = new Map<string, NormalizedTransaction>();
    for (const t of all) if (!byId.has(t.txid)) byId.set(t.txid, t);
    const ordered = [...byId.values()].sort(
      (a, b) => (b.status.blockTime ?? Infinity) - (a.status.blockTime ?? Infinity),
    );
    setWalletTxs(ordered);
    setTxVisible(TX_PAGE);
    setTxPartial(partial);
    setHistoryState('done');
    // Cache a sparkline on the saved card, if this is a saved wallet.
    const saved = loadWallets().find(w => w.input === input.trim() && w.networkId === networkId);
    if (saved && built.points.length >= 2) {
      const move = lastMovement(all, addrSet);
      updateSnapshot(saved.id, {
        balanceSats: scan.balanceSats, usedCount: scan.usedCount, txTotal: scan.txTotal,
        scannedAt: saved.snapshot?.scannedAt ?? Date.now(), sparkline: toSparkline(built),
        ...(move ? { lastMovementAt: move.time, lastMovementSats: move.deltaSats } : {}),
      });
    }
  }, [state, provider, input, networkId]);

  // Kick the history walk off automatically, but LAST: only once the scan has
  // landed, and as bulk requests, so it never delays the dashboard or anything
  // interactive. Slow is fine here; a missing chart is not.
  useEffect(() => {
    if (state.kind === 'loaded' && historyState === 'idle') void loadHistory();
  }, [state, historyState, loadHistory]);

  if (state.kind === 'error') {
    return (
      <div className="flex flex-col gap-1 px-4 py-3" style={{ border: '1px solid #e06060', borderRadius: 2 }}>
        <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: '#e06060' }}>COULD NOT LOAD</span>
        <p className="font-numbers m-0" style={{ fontSize: 13, color: 'var(--alice-text)' }}>{state.message}</p>
      </div>
    );
  }

  // While the scan runs the dashboard still renders, fed by the partial
  // snapshots (updated every ten scanned addresses) and marked as scanning;
  // until the very first window lands, the page is a structured skeleton.
  const scanning = state.kind === 'loading';
  const descriptor = state.kind === 'loaded' ? state.descriptor : parsed;
  const scan: WalletScan | null = state.kind === 'loaded'
    ? state.scan
    : partial && descriptor
      ? {
          descriptor,
          receive: partial.receive,
          change: partial.change,
          balanceSats: partial.balanceSats,
          txTotal: partial.txTotal,
          usedCount: partial.usedCount,
          degraded: false,
          reachedCap: false,
          throttled: false,
        }
      : null;

  if (!descriptor || !scan) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 px-4 py-3" style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}>
          <Skeleton width={180} height={16} />
          <Skeleton width="80%" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
            {['BALANCE', 'USED ADDRESSES', 'RECEIVE / CHANGE', 'ACTIVITY'].map(l => (
              <div key={l} className="flex flex-col gap-1">
                <span className="font-pixel tracking-widest" style={{ fontSize: 6, color: 'var(--alice-muted)' }}>{l}</span>
                <Skeleton width="60%" />
              </div>
            ))}
          </div>
          <Analyzing label={progress
            ? `scanning… ${progress.scanned} address${progress.scanned === 1 ? '' : 'es'} checked, ${progress.used} used so far`
            : `deriving and scanning addresses via ${provider.source.name}…`} />
        </div>
        <SectionPanel title="BALANCE"><div className="px-3 py-3"><Skeleton height={110} /></div></SectionPanel>
        <SectionPanel title="TRANSACTIONS"><div className="px-3 py-3"><SkeletonLines lines={4} /></div></SectionPanel>
        <SectionPanel title="UNSPENT OUTPUTS">
          <div className="flex items-center justify-center gap-3 px-3 py-4">
            <Skeleton width={64} height={64} style={{ borderRadius: '50%' }} />
            <Skeleton width={40} height={40} style={{ borderRadius: '50%' }} />
            <Skeleton width={26} height={26} style={{ borderRadius: '50%' }} />
          </div>
        </SectionPanel>
        <SectionPanel title="USED ADDRESSES"><div className="px-3 py-3"><SkeletonLines lines={5} /></div></SectionPanel>
      </div>
    );
  }
  const used = [...scan.receive, ...scan.change].sort((a, b) => (a.chain - b.chain) || (a.index - b.index));
  const walletAddrSet = new Set([...scan.receive, ...scan.change].map(a => a.address));

  return (
    <div className="flex flex-col gap-4">
      {/* Dashboard */}
      <div
        className="flex flex-col gap-3 px-4 py-3"
        style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="primary">{descriptor.kind === 'xpub' ? 'EXTENDED KEY' : 'DESCRIPTOR'}</Badge>
          <Badge tone="neutral">{SCRIPT_LABEL[descriptor.scriptHint] ?? descriptor.scriptHint}</Badge>
        </div>
        <p className="font-numbers m-0 break-all" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{descriptor.receive}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
          <Metric label="BALANCE" value={<Amount sats={scan.balanceSats} style={{ fontSize: 13, color: 'var(--alice-text)' }} />} />
          <Metric label="USED ADDRESSES" value={scan.usedCount.toLocaleString('en-US')} />
          <Metric label="RECEIVE / CHANGE" value={`${scan.receive.length} / ${scan.change.length}`} />
          <Metric label="ACTIVITY" value={`${scan.txTotal.toLocaleString('en-US')} tx`} />
        </div>
        {/* While the scan is still walking, the totals above are live partials:
            say so, with the running counter. */}
        {scanning && (
          <Analyzing label={`scanning… ${progress?.scanned ?? 0} address${(progress?.scanned ?? 0) === 1 ? '' : 'es'} checked, totals update as it goes`} />
        )}
      </div>

      {/* Balance over time: loads automatically after the scan (bulk-priority
          history walk), so the dashboard above always paints first. The panel
          is in place from the start and its skeleton is swapped for the chart. */}
      {series && series.points.length >= 2 ? (
        <div className="rh-fade-in"><ExplorerBalanceChart points={series.points} partial={txPartial} /></div>
      ) : scanning || (scan.usedCount > 0 && historyState !== 'unsupported' && historyState !== 'done') ? (
        <SectionPanel title="BALANCE"><div className="px-3 py-3"><Skeleton height={110} /></div></SectionPanel>
      ) : scan.usedCount > 0 && historyState === 'done' ? (
        <SectionPanel title="BALANCE">
          <p className="font-numbers m-0 px-3 py-3" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
            No dated history to chart.
          </p>
        </SectionPanel>
      ) : null}

      {/* Transaction history across the whole wallet: every tx touching any of
          its addresses, with its net effect on the wallet. Loads with the
          balance history (bulk), so it appears once the walk lands. */}
      {historyState !== 'unsupported' && (scanning || scan.usedCount > 0) && (
        <div className="flex flex-col" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: 'var(--alice-bg-soft)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>TRANSACTIONS</span>
            <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
              {walletTxs.length > 0
                ? `${Math.min(txVisible, walletTxs.length).toLocaleString('en-US')} of ${walletTxs.length.toLocaleString('en-US')}${txPartial ? '+' : ''}`
                : historyState === 'loading' ? 'loading…' : '0'}
            </span>
          </div>
          {walletTxs.length === 0 ? (
            !scanning && historyState === 'done'
              ? <EmptyState glyph="○" title="No transactions found" hint="No dated history came back for this wallet's addresses." />
              : <div className="px-3 py-3"><SkeletonLines lines={4} /></div>
          ) : (
            <div className="rh-fade-in">
              {walletTxs.slice(0, txVisible).map(tx => (
                <WalletTxRow key={tx.txid} tx={tx} addresses={walletAddrSet} onOpen={() => onOpenTx(tx.txid)} />
              ))}
            </div>
          )}
          {txVisible < walletTxs.length && (
            <button
              type="button"
              onClick={() => setTxVisible(v => v + TX_PAGE)}
              className="font-pixel tracking-widest cursor-pointer bg-transparent px-3 py-2"
              style={{ fontSize: 7, color: 'var(--alice-primary)', borderTop: '1px solid var(--alice-border)' }}
            >
              LOAD {Math.min(TX_PAGE, walletTxs.length - txVisible)} MORE
            </button>
          )}
        </div>
      )}

      {/* Unspent outputs across the whole wallet, packed by value. Fetched at
          the end of the scan, so the panel holds its place until then. */}
      {scan.utxos && scan.utxos.length > 0 ? (
        <div className="rh-fade-in"><ExplorerUtxoBubbles utxos={scan.utxos} /></div>
      ) : scanning ? (
        <SectionPanel title="UNSPENT OUTPUTS">
          <div className="flex items-center justify-center gap-3 px-3 py-4">
            <Skeleton width={64} height={64} style={{ borderRadius: '50%' }} />
            <Skeleton width={40} height={40} style={{ borderRadius: '50%' }} />
            <Skeleton width={26} height={26} style={{ borderRadius: '50%' }} />
          </div>
        </SectionPanel>
      ) : scan.utxos ? (
        <SectionPanel title="UNSPENT OUTPUTS">
          <p className="font-numbers m-0 px-3 py-3" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
            No coins held in this wallet right now.
          </p>
        </SectionPanel>
      ) : null}

      {scan.throttled && (
        <div className="flex flex-col gap-2 px-4 py-3" style={{ border: '1px solid #e0a060', borderRadius: 2 }}>
          <Badge tone="medium">SCAN INCOMPLETE</Badge>
          <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
            {provider.source.name} rate-limited the address lookups, so the scan stopped early and the totals
            may be incomplete.
          </p>
          <a
            href="/settings/"
            className="font-pixel tracking-widest self-start"
            style={{ fontSize: 7, padding: '6px 12px', border: '2px solid #e0a060', borderRadius: 2, color: '#e0a060', textDecoration: 'none' }}
          >
            SET YOUR NODE →
          </a>
        </div>
      )}
      {!scan.throttled && (scan.degraded || scan.reachedCap) && (
        <p className="font-numbers m-0" style={{ fontSize: 11, color: '#e0a060' }}>
          {scan.reachedCap ? 'The scan hit its address cap; a very large wallet may be truncated. ' : ''}
          {scan.degraded ? 'Some lookups failed, so the totals may be understated.' : ''}
        </p>
      )}

      {/* Privacy note: the reuse aggregate. */}
      {used.some(a => a.stats.fundedCount > 1) && (
        <div
          className="flex flex-col gap-2 px-4 py-3"
          style={{ border: '1px solid var(--alice-border)', borderLeft: '3px solid #e0a060', borderRadius: 2 }}
        >
          <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-text)' }}>Address reuse in this wallet</span>
          <p className="font-numbers m-0" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--alice-muted)' }}>
            Some addresses here received funds more than once. Reuse publicly ties those payments to
            the same wallet and makes its activity easy to follow.
          </p>
        </div>
      )}

      {/* Derived, used addresses. */}
      <div className="flex flex-col" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
        <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: 'var(--alice-bg-soft)' }}>
          <span className="font-pixel tracking-widest" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>USED ADDRESSES</span>
          <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>{used.length.toLocaleString('en-US')}</span>
        </div>
        {used.length === 0 ? (
          scanning ? (
            <div className="px-3 py-3"><SkeletonLines lines={4} /></div>
          ) : (
            <EmptyState
              glyph="○"
              title="No used addresses in range"
              hint="This wallet looks empty or unused. The derived addresses below still let you cross-check it."
            />
          )
        ) : (
          used.map(a => <AddressRow key={`${a.chain}/${a.index}`} a={a} onOpen={() => onOpenAddress(a.address)} />)
        )}
        {/* The list keeps growing while the walk continues. */}
        {scanning && used.length > 0 && <Analyzing label="scanning for more used addresses…" />}
      </div>

      {/* Query-privacy notice. */}
      <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.7 }}>
        Scanning a wallet asks {provider.source.name} about each derived address, revealing to that server
        that they interest you. On your own node this stays private.
      </p>
    </div>
  );
}
