'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChainDataProvider, RequestOptions } from '@/lib/explorer/provider';
import { ChainDataError } from '@/lib/explorer/provider';
import type { NormalizedTransaction } from '@/lib/explorer/types';
import { buildAddressContext, buildFullAddressDescription, detectAddressReuseForAddress, renderSignalsIdentified, type AddressStats, type PrivacySignal } from '@/lib/explorer/signals';
import type { FullContext } from '@/lib/explorer/ask-alice';
import { buildBalanceSeries } from '@/lib/explorer/balance-history';
import type { EntityLabel } from '@/lib/explorer/entities';
import { mergeLabels, remoteEntitiesConfigured, remoteEntityLookup } from '@/lib/explorer/entity-remote';
import { averageUtxoAge, linkedAddresses, type AddressUtxo } from '@/lib/explorer/address-insights';
import { ExplorerBalanceChart } from '@/components/ExplorerBalanceChart';
import { ExplorerUtxoBubbles } from '@/components/ExplorerUtxoBubbles';
import { ExplorerEntityCard } from '@/components/ExplorerEntityCard';
import { ExplorerQuantumCard } from '@/components/ExplorerQuantumCard';
import { explorerEntityStore } from '@/lib/explorer/entity-seed';
import { detectEntityLink } from '@/lib/explorer/entity-signal';
import { analyzeQuantumExposure, detectQuantumExposure } from '@/lib/explorer/quantum';
import { Amount, formatAmount, useAmountState } from '@/components/AmountDisplay';
import { Analyzing, SectionPanel, Skeleton, SkeletonLines } from '@/components/ExplorerUI';
import { formatDateTime } from '@/lib/explorer/blocks';

function shortAddr(a: string): string {
  return a.length > 20 ? `${a.slice(0, 10)}...${a.slice(-6)}` : a;
}

function formatAge(days: number): string {
  if (days < 1) return 'under a day';
  if (days < 45) return `${Math.round(days)} days`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

// Received vs sent as a single bar: the whole width is the total received, the
// shaded part is what has since been sent, the bright part is the held balance.
function ReceivedSentBar({ received, sent }: { received: number; sent: number }) {
  const total = Math.max(1, received);
  const sentPct = Math.min(100, (sent / total) * 100);
  const unit = useAmountState();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-3 w-full overflow-hidden" style={{ borderRadius: 2, backgroundColor: 'var(--alice-bg)' }}>
        <div style={{ width: `${sentPct}%`, backgroundColor: 'var(--alice-muted)' }} />
        <div style={{ width: `${100 - sentPct}%`, backgroundColor: 'var(--alice-primary)' }} />
      </div>
      <div className="flex justify-between font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
        <span>Sent {formatAmount(sent, unit)}</span>
        <span style={{ color: 'var(--alice-primary)' }}>Held {formatAmount(received - sent, unit)}</span>
      </div>
    </div>
  );
}

// Cap the history walk so a very busy address cannot spawn hundreds of requests.
const MAX_TXS = 500;
// The list opens short (the page is already dense) and pages out on demand.
const LIST_INITIAL = 5;
const LIST_PAGE = 10;

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; stats: AddressStats };

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{label}</span>
      <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-text)' }}>{value}</span>
    </div>
  );
}

function btc(sats: number): string {
  return `${(sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`;
}
function shortTxid(txid: string): string {
  return `${txid.slice(0, 10)}...${txid.slice(-8)}`;
}
function shortDate(sec?: number): string {
  return sec ? new Date(sec * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
}

function TxRow({ tx, onOpen }: { tx: NormalizedTransaction; onOpen: () => void }) {
  const outTotal = tx.outputs.reduce((s, o) => s + o.valueSats, 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center justify-between gap-3 w-full text-left cursor-pointer bg-transparent px-3 py-2"
      style={{ borderTop: '1px solid var(--alice-border)' }}
    >
      <div className="flex flex-col min-w-0">
        <span className="font-numbers truncate" style={{ fontSize: 12, color: 'var(--alice-text)' }} title={tx.txid}>{shortTxid(tx.txid)}</span>
        <span className="font-numbers" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
          {tx.status.confirmed ? `block ${tx.status.blockHeight?.toLocaleString('en-US')}` : 'unconfirmed'}
          {tx.status.blockTime ? ` - ${formatDateTime(tx.status.blockTime)}` : ''}
          {' - '}{tx.inputs.length} in / {tx.outputs.length} out
        </span>
      </div>
      <Amount sats={outTotal} style={{ fontSize: 12, color: 'var(--alice-text)', flexShrink: 0 }} />
    </button>
  );
}

export function ExplorerAddressTab({
  address,
  provider,
  onOpenTx,
  onOpenAddress,
  onSignals,
  confidentialAmounts = false,
  remoteEntities = false,
}: {
  address: string;
  provider: ChainDataProvider;
  onOpenTx: (txid: string) => void;
  onOpenAddress: (address: string) => void;
  /** Report the privacy signals once analysed, plus the identified-mode full
      description, for the Ask-Alice sidebar. */
  onSignals?: (signals: PrivacySignal[], full?: FullContext) => void;
  /** True on Liquid: amounts are blinded, so balances are shown as "unknown"
      and the amount-based views (received bar, balance chart) are dropped. */
  confidentialAmounts?: boolean;
  /** True where the server-side entity dataset applies (Bitcoin mainnet): also
      query the Worker for the giant packs the client does not bundle. */
  remoteEntities?: boolean;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [txs, setTxs] = useState<NormalizedTransaction[]>([]);
  const [utxos, setUtxos] = useState<AddressUtxo[]>([]);
  // True when the provider refused the UTXO list (the public endpoint caps at
  // 500 outputs); the bubbles then fall back to what the history shows.
  const [utxosUnavailable, setUtxosUnavailable] = useState(false);
  // True once the UTXO request answered (either way), and once the history
  // walk finished: they turn the skeletons into data or explicit empty states.
  const [utxosLoaded, setUtxosLoaded] = useState(false);
  const [historyDone, setHistoryDone] = useState(false);
  const [partial, setPartial] = useState(false);
  const [visible, setVisible] = useState(LIST_INITIAL);
  // Extra sourced labels from the Worker (the giant packs not bundled locally).
  const [remoteLabels, setRemoteLabels] = useState<EntityLabel[]>([]);

  // Kept in a ref so reporting signals never forces the fetch effect to re-run.
  const onSignalsRef = useRef(onSignals);
  onSignalsRef.current = onSignals;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState({ kind: 'loading' });
    setTxs([]); setUtxos([]); setUtxosUnavailable(false); setUtxosLoaded(false); setHistoryDone(false);
    setPartial(false); setVisible(LIST_INITIAL); setRemoteLabels([]);

    (async () => {
      let stats: AddressStats;
      try {
        stats = await provider.getAddressStats(address, { signal: controller.signal });
      } catch (err) {
        if (cancelled || (err instanceof ChainDataError && err.code === 'aborted')) return;
        setState({ kind: 'error', message: err instanceof ChainDataError ? err.message : 'Could not load this address.' });
        return;
      }
      if (cancelled) return;
      setState({ kind: 'loaded', stats });
      const reuse = detectAddressReuseForAddress(stats);
      // Sourced entity attribution becomes a signal too, so a known exchange or
      // sanctioned link reaches the audit and Alice (as a category, never a name).
      // The bundled dataset is authoritative on its own; the Worker adds the
      // giant packs when available, merged so display and signal stay in sync.
      const localLabels = explorerEntityStore.lookupAddress(address);
      let mergedLabels = localLabels;
      if (remoteEntities && remoteEntitiesConfigured()) {
        try {
          const remote = await remoteEntityLookup([address], { signal: controller.signal });
          const extra = remote.get(address) ?? [];
          if (cancelled) return;
          if (extra.length > 0) { setRemoteLabels(extra); mergedLabels = mergeLabels(localLabels, extra); }
        } catch { /* offline or unconfigured: the bundled set still stands */ }
      }
      const entitySignals = detectEntityLink(address, mergedLabels);
      const quantumSignals = detectQuantumExposure(address, stats);
      const findings = renderSignalsIdentified([...reuse, ...entitySignals, ...quantumSignals]);
      onSignalsRef.current?.(
        [buildAddressContext(stats), ...reuse, ...entitySignals, ...quantumSignals],
        {
          description: findings ? `${buildFullAddressDescription(stats)}\n\n${findings}` : buildFullAddressDescription(stats),
          subjects: [{ kind: 'address', value: stats.address }],
        },
      );

      // Unspent outputs, for coin-age (best-effort, independent of the history).
      // A refusal (the public endpoint caps busy addresses at 500 UTXOs) is
      // remembered so the bubbles can fall back to the loaded history.
      if (typeof provider.getAddressUtxos === 'function') {
        provider.getAddressUtxos(address, { signal: controller.signal })
          .then(u => { if (!cancelled) { setUtxos(u); setUtxosLoaded(true); } })
          .catch(err => {
            if (!cancelled && !(err instanceof ChainDataError && err.code === 'aborted')) {
              setUtxosUnavailable(true);
              setUtxosLoaded(true);
            }
          });
      } else {
        setUtxosLoaded(true);
      }

      // Walk the whole history (bounded) so the chart is complete. Bulk
      // traffic: it yields to interactive requests and dies with the tab.
      if (typeof provider.getAddressTxs !== 'function') { setHistoryDone(true); return; }
      const request: RequestOptions = { signal: controller.signal, priority: 'bulk', timeoutMs: 8_000 };
      const all: NormalizedTransaction[] = [];
      let after: string | undefined;
      while (all.length < MAX_TXS) {
        let page: NormalizedTransaction[];
        try {
          page = await provider.getAddressTxs(address, after, request);
        } catch { break; }
        if (cancelled) return;
        if (page.length === 0) break;
        all.push(...page);
        setTxs([...all]);
        if (page.length < 25) break; // last page
        after = page[page.length - 1].txid;
      }
      if (!cancelled && all.length >= MAX_TXS) setPartial(true);
      if (!cancelled) setHistoryDone(true);
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [address, provider, remoteEntities]);

  const stats = state.kind === 'loaded' ? state.stats : null;
  const balance = stats ? stats.fundedSum - stats.spentSum : 0;
  const series = useMemo(
    () => (stats ? buildBalanceSeries(txs, address, balance) : null),
    [txs, address, balance, stats],
  );
  const linked = useMemo(() => linkedAddresses(txs, address), [txs, address]);
  // When the UTXO endpoint refused (giant address), approximate from the
  // loaded history: outputs paying this address that no loaded transaction
  // spends. Recent coins only, marked as such where they are shown.
  const fallbackUtxos = useMemo<AddressUtxo[]>(() => {
    if (!utxosUnavailable || txs.length === 0) return [];
    const spent = new Set<string>();
    for (const t of txs) for (const i of t.inputs) spent.add(`${i.prevTxid}:${i.prevVout}`);
    const out: AddressUtxo[] = [];
    for (const t of txs) {
      for (const o of t.outputs) {
        if (o.address === address && !spent.has(`${t.txid}:${o.index}`)) {
          out.push({ valueSats: o.valueSats, blockTime: t.status.blockTime });
        }
      }
    }
    return out;
  }, [utxosUnavailable, txs, address]);
  const shownUtxos = utxos.length > 0 ? utxos : fallbackUtxos;
  const coinAge = useMemo(() => averageUtxoAge(shownUtxos, Math.floor(Date.now() / 1000)), [shownUtxos]);
  // Sourced entity attribution for this address (bundled set plus any Worker
  // labels that arrived), if any is known.
  const entityLabels = useMemo(
    () => mergeLabels(explorerEntityStore.lookupAddress(address), remoteLabels),
    [address, remoteLabels],
  );
  // Quantum key exposure for the funds held here.
  const quantum = useMemo(() => (stats ? analyzeQuantumExposure(address, stats) : null), [address, stats]);

  if (state.kind === 'loading') {
    // The whole page structure is laid out from the first paint: every section
    // shows as a skeleton and is later swapped in place, so nothing pops in.
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 px-4 py-3" style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}>
          <Skeleton width="60%" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
            {['BALANCE', 'TRANSACTIONS', 'TIMES RECEIVED', 'RECEIVED', 'FIRST SEEN', 'AVG COIN AGE'].map(l => (
              <div key={l} className="flex flex-col gap-1">
                <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{l}</span>
                <Skeleton width="60%" />
              </div>
            ))}
          </div>
        </div>
        <SectionPanel title="BALANCE"><div className="px-3 py-3"><Skeleton height={110} /></div></SectionPanel>
        <SectionPanel title="UNSPENT OUTPUTS">
          <div className="flex items-center justify-center gap-3 px-3 py-4">
            <Skeleton width={64} height={64} style={{ borderRadius: '50%' }} />
            <Skeleton width={40} height={40} style={{ borderRadius: '50%' }} />
            <Skeleton width={26} height={26} style={{ borderRadius: '50%' }} />
          </div>
        </SectionPanel>
        <SectionPanel title="SIGNALS"><Analyzing label={`analyzing address on ${provider.source.name}…`} /></SectionPanel>
        <SectionPanel title="TRANSACTIONS"><div className="px-3 py-3"><SkeletonLines lines={5} /></div></SectionPanel>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="flex flex-col gap-1 px-4 py-3" style={{ border: '1px solid var(--alice-danger)', borderRadius: 2 }}>
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-danger)' }}>COULD NOT LOAD</span>
        <p className="font-numbers m-0" style={{ fontSize: 13, color: 'var(--alice-text)' }}>{state.message}</p>
      </div>
    );
  }

  const s = state.stats;
  const reused = s.fundedCount > 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Dashboard */}
      <div
        className="flex flex-col gap-3 px-4 py-3 rh-fade-in"
        style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)' }}
      >
        <p className="font-numbers m-0 break-all" style={{ fontSize: 13, color: 'var(--alice-text)' }}>{s.address}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
          {/* On Liquid the balance is blinded: show it as unknown, keep the
              counts (they are public), and drop the amount-derived metrics. */}
          <Metric label="BALANCE" value={confidentialAmounts
            ? <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-muted)' }}>unknown</span>
            : <Amount sats={balance} style={{ fontSize: 14, color: 'var(--alice-text)' }} />} />
          <Metric label="TRANSACTIONS" value={s.txCount.toLocaleString('en-US')} />
          <Metric label="TIMES RECEIVED" value={s.fundedCount.toLocaleString('en-US')} />
          <Metric label="RECEIVED" value={confidentialAmounts
            ? <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-muted)' }}>unknown</span>
            : <Amount sats={s.fundedSum} style={{ fontSize: 14, color: 'var(--alice-text)' }} />} />
          <Metric label="FIRST SEEN" value={shortDate(series?.firstSeen ?? undefined)} />
          {!confidentialAmounts && (
            <Metric label="AVG COIN AGE" value={coinAge ? formatAge(coinAge.days) : (balance > 0 ? '-' : 'no coins held')} />
          )}
        </div>
        {/* Received vs sent split (amount-based, so Bitcoin only). */}
        {!confidentialAmounts && s.fundedSum > 0 && <ReceivedSentBar received={s.fundedSum} sent={s.spentSum} />}
      </div>

      {/* Balance over time (amount-based, so Bitcoin only). The section frame
          is there from the start; the chart replaces its skeleton in place. */}
      {!confidentialAmounts && (
        series && series.points.length >= 2 ? (
          <div className="rh-fade-in"><ExplorerBalanceChart points={series.points} partial={partial} /></div>
        ) : !historyDone ? (
          <SectionPanel title="BALANCE"><div className="px-3 py-3"><Skeleton height={110} /></div></SectionPanel>
        ) : (
          <SectionPanel title="BALANCE">
            <p className="font-numbers m-0 px-3 py-3" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
              No dated history to chart for this address.
            </p>
          </SectionPanel>
        )
      )}
      {/* On Liquid the amounts are blinded: the panel still holds its place
          and says why there is no timeline, instead of silently missing. */}
      {confidentialAmounts && (
        <SectionPanel title="BALANCE">
          <p className="font-numbers m-0 px-3 py-3" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
            Amounts on this network are confidential (blinded), so a balance timeline cannot be charted.
          </p>
        </SectionPanel>
      )}

      {/* Unspent outputs, same in-place swap. On Liquid the amounts are
          blinded, so the graph shows equal-sized bubbles. */}
      {shownUtxos.length > 0 ? (
        <div className="flex flex-col gap-1 rh-fade-in">
          <ExplorerUtxoBubbles
            utxos={shownUtxos}
            confidential={confidentialAmounts}
            title={utxos.length === 0 ? 'RECENT UNSPENT OUTPUTS' : 'UNSPENT OUTPUTS'}
          />
          {utxos.length === 0 && (
            <span className="font-numbers" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.7 }}>
              This address holds too many UTXOs for the public endpoint; showing the unspent coins found in the loaded history only.
            </span>
          )}
        </div>
      ) : !utxosLoaded || (utxosUnavailable && !historyDone) ? (
        <SectionPanel title="UNSPENT OUTPUTS">
          <div className="flex items-center justify-center gap-3 px-3 py-4">
            <Skeleton width={64} height={64} style={{ borderRadius: '50%' }} />
            <Skeleton width={40} height={40} style={{ borderRadius: '50%' }} />
            <Skeleton width={26} height={26} style={{ borderRadius: '50%' }} />
          </div>
        </SectionPanel>
      ) : (
        <SectionPanel title="UNSPENT OUTPUTS">
          <p className="font-numbers m-0 px-3 py-3" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
            No coins held on this address right now.
          </p>
        </SectionPanel>
      )}

      {/* Query-privacy notice. */}
      <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.7 }}>
        Looking up an address tells {provider.source.name} that this address is of interest to you.
      </p>

      {/* The stable SIGNALS zone: the analysis cards land here as they are
          computed; while the history walk still runs, the pending row says so,
          so nothing seems missing or suddenly appears out of nowhere. */}
      <SectionPanel title="SIGNALS">
        <div className="flex flex-col gap-3 px-3 py-3">
      {/* Sourced entity attribution, when this address is known. */}
      <ExplorerEntityCard labels={entityLabels} />

      {/* Address-level reuse signal. */}
      {reused && (
        <div
          className="flex flex-col gap-2 px-4 py-3"
          style={{ border: '1px solid var(--alice-border)', borderLeft: '3px solid var(--alice-warning)', borderRadius: 2 }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-text)' }}>Address reuse</span>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--alice-warning)', borderRadius: 2, color: 'var(--alice-warning)' }}>MEDIUM</span>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--alice-muted)', borderRadius: 2, color: 'var(--alice-muted)' }}>CERTAIN CONFIDENCE</span>
          </div>
          <p className="font-numbers m-0" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--alice-muted)' }}>
            This address has received funds {s.fundedCount} times. Reusing an address publicly ties
            all those payments to the same owner and makes activity easy to follow.
          </p>
        </div>
      )}

      {/* Linked addresses (common-input-ownership): computed from the history
          walk, so it can land late; it fades into the zone when found. */}
      {linked.length > 0 && (
        <div
          className="flex flex-col gap-2 px-4 py-3 rh-fade-in"
          style={{ border: '1px solid var(--alice-border)', borderLeft: '3px solid var(--alice-warning)', borderRadius: 2 }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-text)' }}>
              {linked.length} linked address{linked.length > 1 ? 'es' : ''}
            </span>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--alice-muted)', borderRadius: 2, color: 'var(--alice-muted)' }}>PROBABLE</span>
          </div>
          <p className="font-numbers m-0" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--alice-muted)' }}>
            These addresses were spent together with this one, so common-input ownership ties them
            to the same wallet{partial ? ' (from the loaded history)' : ''}.
          </p>
          <div className="flex flex-wrap gap-2">
            {linked.slice(0, 12).map(a => (
              <button
                key={a}
                type="button"
                onClick={() => onOpenAddress(a)}
                className="font-numbers cursor-pointer"
                style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'transparent', color: 'var(--alice-primary)' }}
                title={a}
              >
                {shortAddr(a)}
              </button>
            ))}
            {linked.length > 12 && (
              <span className="font-numbers" style={{ fontSize: 11, color: 'var(--alice-muted)', alignSelf: 'center' }}>
                +{linked.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* While the history walk runs, say that more analysis is coming. */}
      {!historyDone && <Analyzing label="scanning the history for linked addresses…" />}

      {/* Quantum key exposure of the funds held here, with the other flags. */}
      {quantum && <ExplorerQuantumCard exposure={quantum} />}

      {/* KYC exposure: intentionally a placeholder. A truthful indicator needs a
          sourced, dated entity dataset (exchanges, services) we have not built
          yet; asserting an exchange link without it would be an unfounded
          accusation, which the engine's rules forbid. */}
      <div
        className="flex flex-col gap-1 px-4 py-3"
        style={{ border: '1px dashed var(--alice-border)', borderRadius: 2 }}
      >
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>KYC EXPOSURE</span>
        <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
          Checking whether this address touches a known exchange or service needs a labelled
          entity database, which is not loaded yet. Coming with the entity dataset.
        </p>
      </div>
        </div>
      </SectionPanel>

      {/* Transactions, sliced client-side from the loaded history; skeleton
          rows until the first page lands, an explicit empty state after. */}
      <SectionPanel
        title="TRANSACTIONS"
        right={
          <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
            {Math.min(visible, txs.length).toLocaleString('en-US')} of {s.txCount.toLocaleString('en-US')}
          </span>
        }
      >
        {txs.length === 0 ? (
          historyDone ? (
            <p className="font-numbers m-0 px-3 py-3" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>No transactions to list.</p>
          ) : (
            <div className="px-3 py-3"><SkeletonLines lines={5} /></div>
          )
        ) : (
          <div className="rh-fade-in">
            {txs.slice(0, visible).map(tx => <TxRow key={tx.txid} tx={tx} onOpen={() => onOpenTx(tx.txid)} />)}
          </div>
        )}
      </SectionPanel>

      {visible < txs.length && (
        <button
          type="button"
          onClick={() => setVisible(v => v + LIST_PAGE)}
          className="font-pixel tracking-widest self-center cursor-pointer"
          style={{
            fontSize: 10, padding: '8px 16px', borderRadius: 2,
            border: '2px solid var(--alice-border)', backgroundColor: 'transparent', color: 'var(--alice-primary)',
          }}
        >
          SHOW MORE
        </button>
      )}
    </div>
  );
}
