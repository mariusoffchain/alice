'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChainDataProvider } from '@/lib/explorer/provider';
import { ChainDataError, type RequestOptions } from '@/lib/explorer/provider';
import { classifySearch } from '@/lib/explorer/search';
import { scanWallet } from '@/lib/explorer/wallet-scan';
import {
  buildBalanceSeries, buildWalletBalanceSeries, collectHistoryTxs, lastMovement, toSparkline,
} from '@/lib/explorer/balance-history';
import { Amount } from '@/components/AmountDisplay';
import { extractWalletInput } from '@/lib/explorer/wallet-import';
import {
  addWallet, loadWallets, removeWallet, syncPlaygroundCard, updateSnapshot, type SavedKind, type SavedWallet,
} from '@/lib/explorer/wallet-store';
import { getPlaygroundAccountXpub } from '@/lib/playground';
import { ExplorerQrScanner, decodeQrFromFile, qrDecodingSupported } from '@/components/ExplorerQrScanner';
import { Analyzing, Badge, EmptyState, Skeleton } from '@/components/ExplorerUI';

// Auto-name an unlabelled item "Wallet 1", "Wallet 2" (or "Address N"), one past
// the highest number already used for that kind, so a new import is never just
// another anonymous "Wallet".
function nextLabel(wallets: SavedWallet[], kind: SavedKind): string {
  const prefix = kind === 'address' ? 'Address' : 'Wallet';
  const re = new RegExp(`^${prefix} (\\d+)$`);
  let max = 0;
  for (const w of wallets) {
    const m = w.label.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix} ${max + 1}`;
}

// The card sparkline's history walk is tighter than the detail view's: enough
// for a trend line, cheap enough to run for every card on the page.
const CARD_HISTORY_ADDRESSES = 10;
const CARD_HISTORY_TXS = 250;
const CARD_HISTORY_BUDGET_MS = 20_000;

function btc(sats: number): string {
  return `${(sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') || '0'} BTC`;
}
function agoLabel(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 60 * 86400) return `${Math.floor(s / 86400)}d ago`;
  if (s < 2 * 365 * 86400) return `${Math.floor(s / (30.44 * 86400))}mo ago`;
  return `${Math.floor(s / (365 * 86400))}y ago`;
}

// A tiny inline balance sparkline for a saved-wallet card. Flat (single value)
// series render as a baseline; anything richer draws the curve.
function Sparkline({ values, height = 28 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;
  const w = 120, h = height, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${h - pad} ${pts.join(' ')} ${w - pad},${h - pad}`;
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', minHeight: h }}>
      <polygon points={area} fill="var(--alice-primary)" opacity={0.12} />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--alice-primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function WalletCard({
  wallet, scanning, onOpen, onRemove,
}: {
  wallet: SavedWallet;
  scanning: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const snap = wallet.snapshot;
  const meta = snap && (wallet.kind === 'address' ? `${snap.txTotal} tx` : `${snap.usedCount} addr`);
  return (
    // The whole card is the door. It used to be three clickable islands
    // (title, balance, sparkline) with dead gaps between them, and a click in
    // a gap read as a broken click. A div with button semantics rather than a
    // <button>, because a button cannot legally contain the remove button.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}
      aria-label={`Open ${wallet.label}`}
      className="rh-card flex flex-col gap-2 px-4 py-4 cursor-pointer"
      style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)', minHeight: 200 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex items-center gap-2 min-w-0 text-left"
        >
          <span className="font-numbers truncate" style={{ fontSize: 15, color: 'var(--alice-primary)' }} title={wallet.label}>
            {wallet.label}
          </span>
          {/* Only the exception gets a badge. The section is already titled
              WALLETS, so stamping WALLET on each card said nothing; ADDR on a
              watched single address is the one distinction worth ink. */}
          {wallet.kind === 'address' && <Badge tone="neutral">ADDR</Badge>}
        </span>
        {/* Secondary actions: revealed on hover / focus / touch (item 7).
            No rescan button any more: the cards keep themselves fresh, and a
            button that does what the page already does is homework. The
            scanning state still shows in the footer line. */}
        <div className="rh-hover-actions flex items-center gap-1 shrink-0">
          {scanning && (
            <span className="font-pixel" style={{ fontSize: 10, color: 'var(--alice-muted)' }} aria-label={`Scanning ${wallet.label}`}>…</span>
          )}
          <button
            type="button"
            onClick={event => { event.stopPropagation(); onRemove(); }}
            aria-label={`Remove ${wallet.label}`}
            className="rh-touch font-pixel tracking-widest cursor-pointer bg-transparent inline-flex items-center justify-center"
            style={{ fontSize: 10, padding: '4px 8px', border: '1px solid var(--alice-border)', borderRadius: 2, color: 'var(--alice-muted)' }}
            title="Remove"
          >
            ×
          </button>
        </div>
      </div>
      {/* Balance: big and primary, in the user's unit (click it to cycle
          ₿ / sats / BTC / fiat, wallet-style). Skeleton while first scan runs. */}
      {snap ? (
        <span className="flex flex-col items-start gap-1 text-left">
          <Amount sats={snap.balanceSats} style={{ fontSize: 24, color: 'var(--alice-text)' }} />
          <span className="font-numbers" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{meta} · scanned {agoLabel(snap.scannedAt)}</span>
        </span>
      ) : scanning ? (
        <div className="flex flex-col gap-1">
          <Skeleton width="55%" height={24} />
          <Analyzing label="scanning this wallet on-chain…" />
        </div>
      ) : (
        <span className="font-numbers" style={{ fontSize: 24, color: 'var(--alice-muted)' }}>-</span>
      )}
      {/* Balance over time fills the middle of the card; the last on-chain
          movement anchors the bottom. */}
      {snap?.sparkline && snap.sparkline.length >= 2 ? (
        <span className="w-full flex-1" title="Balance over time" style={{ minHeight: 44, display: 'block' }}>
          <Sparkline values={snap.sparkline} height={44} />
        </span>
      ) : (
        <div className="flex-1" />
      )}
      {snap?.lastMovementAt && (
        <div className="flex items-baseline gap-2">
          <span className="font-pixel tracking-widest shrink-0" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>LAST MOVE</span>
          <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>{agoLabel(snap.lastMovementAt * 1000)}</span>
          {snap.lastMovementSats !== undefined && (
            <span className="ml-auto">
              <Amount
                sats={snap.lastMovementSats}
                signed
                style={{ fontSize: 12, color: snap.lastMovementSats >= 0 ? 'var(--alice-text)' : 'var(--alice-muted)' }}
              />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ExplorerWalletCards({
  activeNetworkId,
  getProvider,
  onOpenXpub,
  onOpenAddress,
}: {
  activeNetworkId: string;
  getProvider: (networkId: string) => ChainDataProvider;
  onOpenXpub: (input: string, label: string, networkId: string) => void;
  onOpenAddress: (address: string) => void;
}) {
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  const [scanning, setScanning] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [scanningQr, setScanningQr] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoScanned = useRef<Set<string>>(new Set());
  // Card refreshes are background work: leaving the page cancels them all.
  // The controller is created IN the effect (not lazily in the ref), so a
  // StrictMode mount-unmount-mount cycle gets a fresh one instead of reusing
  // the aborted controller of the first pass, which silently cancelled every
  // scan before it started.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => { controller.abort(); abortRef.current = null; };
  }, []);

  useEffect(() => {
    setWallets(loadWallets());
    // The practice wallet's own card: reconciled on every visit, so it
    // appears when the wallet exists and leaves when it is deleted.
    void getPlaygroundAccountXpub()
      .then(xpub => setWallets(syncPlaygroundCard(xpub)))
      .catch(() => {});
  }, []);

  const scan = useCallback(async (wallet: SavedWallet) => {
    const signal = abortRef.current?.signal;
    const request: RequestOptions = { signal, priority: 'bulk', timeoutMs: 8_000 };
    const provider = getProvider(wallet.networkId);

    // Balance-over-time sparkline (and last-movement date) for the card, from
    // a bounded history walk. Best effort AND time-boxed: past its own budget
    // every walk request dies at once, and any failure just leaves the card
    // without a chart (an earlier sparkline, e.g. from the detail view, is kept).
    const chartOf = async (
      addresses: string[],
      balanceSats: number,
    ): Promise<{ sparkline: number[]; lastMovementAt?: number; lastMovementSats?: number } | undefined> => {
      if (typeof provider.getAddressTxs !== 'function' || addresses.length === 0) return undefined;
      const budget = AbortSignal.timeout(CARD_HISTORY_BUDGET_MS);
      const walkRequest: RequestOptions = {
        ...request,
        signal: signal ? AbortSignal.any([signal, budget]) : budget,
      };
      try {
        const { txs } = await collectHistoryTxs(
          provider.getAddressTxs.bind(provider), addresses,
          CARD_HISTORY_ADDRESSES, CARD_HISTORY_TXS, walkRequest,
        );
        const series = addresses.length === 1
          ? buildBalanceSeries(txs, addresses[0], balanceSats)
          : buildWalletBalanceSeries(txs, new Set(addresses), balanceSats);
        const move = lastMovement(txs, addresses.length === 1 ? addresses[0] : new Set(addresses));
        // An empty result is stored too ([]), so a chartless wallet is not
        // re-walked on every visit to the page.
        return {
          sparkline: toSparkline(series),
          lastMovementAt: move?.time,
          lastMovementSats: move?.deltaSats,
        };
      } catch (err) {
        // Only the page-level abort propagates; a blown budget is no chart.
        if (signal?.aborted) throw err;
        return undefined;
      }
    };
    // updateSnapshot merges, so the chart fields are only included when the
    // walk produced them; a failed walk keeps whatever the card already had.
    const chartPatch = (chart: { sparkline: number[]; lastMovementAt?: number; lastMovementSats?: number } | undefined) => ({
      ...(chart ? { sparkline: chart.sparkline } : {}),
      ...(chart?.lastMovementAt !== undefined ? { lastMovementAt: chart.lastMovementAt } : {}),
      ...(chart?.lastMovementSats !== undefined ? { lastMovementSats: chart.lastMovementSats } : {}),
    });

    setScanning(prev => new Set(prev).add(wallet.id));
    try {
      if (wallet.kind === 'address') {
        const stats = await provider.getAddressStats(wallet.input, request);
        const balanceSats = Math.max(0, stats.fundedSum - stats.spentSum);
        const chart = stats.txCount > 0 ? await chartOf([wallet.input], balanceSats) : { sparkline: [] };
        updateSnapshot(wallet.id, {
          balanceSats,
          usedCount: stats.txCount > 0 ? 1 : 0,
          txTotal: stats.txCount,
          scannedAt: Date.now(),
          ...chartPatch(chart),
        });
      } else {
        // The derivation library loads lazily, only when a wallet card scans.
        const derive = await import('@/lib/explorer/wallet-derive');
        const descriptor = derive.parseWalletInput(wallet.input, derive.deriveNetworkFor(wallet.networkId));
        const result = await scanWallet(descriptor, provider, { signal });
        const used = [...result.receive, ...result.change].map(a => a.address);
        const chart = used.length > 0 ? await chartOf(used, result.balanceSats) : { sparkline: [] };
        updateSnapshot(wallet.id, {
          balanceSats: result.balanceSats, usedCount: result.usedCount, txTotal: result.txTotal,
          scannedAt: Date.now(),
          ...chartPatch(chart),
        });
      }
      setWallets(loadWallets());
    } catch (err) {
      if (err instanceof ChainDataError && err.code === 'aborted') return;
      /* leave the card without a snapshot; opening it surfaces the real error */
    } finally {
      setScanning(prev => { const n = new Set(prev); n.delete(wallet.id); return n; });
    }
  }, [getProvider]);

  // Auto-scan, once, sequentially: wallets with no cached snapshot yet, plus
  // active wallets whose snapshot predates the card sparkline (so every card
  // gains its chart without the user opening each wallet).
  useEffect(() => {
    const pending = wallets.filter(w =>
      (!w.snapshot || (w.snapshot.usedCount > 0 && w.snapshot.sparkline === undefined))
      && !autoScanned.current.has(w.id));
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const w of pending) {
        if (cancelled) return;
        autoScanned.current.add(w.id);
        await scan(w);
      }
    })();
    return () => { cancelled = true; };
  }, [wallets, scan]);

  // Keep the numbers honest without a button. A snapshot older than the
  // interval is rescanned, sequentially, and only while the tab is actually
  // being looked at: a hidden tab polling an Esplora API is cost without a
  // reader. The manual rescan button this replaces asked the person to do,
  // on a schedule, what a page can do for itself.
  useEffect(() => {
    const STALE_MS = 3 * 60 * 1000;
    let cancelled = false;
    const refreshStale = async () => {
      if (document.visibilityState !== 'visible') return;
      const stale = loadWallets().filter(w =>
        w.snapshot && Date.now() - w.snapshot.scannedAt > STALE_MS);
      for (const w of stale) {
        if (cancelled) return;
        await scan(w);
      }
    };
    void refreshStale();
    const interval = setInterval(() => { void refreshStale(); }, STALE_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [scan]);

  async function handleAdd() {
    setError('');
    const trimmed = input.trim();
    if (!trimmed) { setError('Paste an address, an extended key (xpub, ypub, zpub) or a descriptor.'); return; }

    // A plain address is saved as an address item (opens the address view).
    if (classifySearch(trimmed).kind === 'address') {
      const finalLabel = label.trim() || nextLabel(wallets, 'address');
      setWallets(addWallet(finalLabel, trimmed, activeNetworkId, 'address'));
      setInput(''); setLabel(''); setAdding(false);
      return;
    }

    // Otherwise treat it as a wallet (extended key or descriptor). The
    // derivation library loads lazily, on the first add.
    const derive = await import('@/lib/explorer/wallet-derive');
    let parsedNetwork: 'bitcoin' | 'testnet';
    try {
      parsedNetwork = derive.parseWalletInput(trimmed, derive.deriveNetworkFor(activeNetworkId)).network;
    } catch (err) {
      setError(err instanceof derive.WalletInputError ? err.message : 'Could not read this input.');
      return;
    }
    // The key's own network must match the tab's network, or scans query the
    // wrong chain. Guide the user to switch rather than silently mis-scan.
    if (parsedNetwork !== derive.deriveNetworkFor(activeNetworkId)) {
      setError(parsedNetwork === 'bitcoin'
        ? 'This is a mainnet key. Switch to Bitcoin to add it.'
        : 'This is a testnet key. Switch to a test network to add it.');
      return;
    }
    const finalLabel = label.trim() || nextLabel(wallets, 'wallet');
    setWallets(addWallet(finalLabel, trimmed, activeNetworkId, 'wallet'));
    setInput(''); setLabel(''); setAdding(false);
  }

  // Import from a file: a plain text/JSON export, or an image holding a QR code.
  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      if (file.type.startsWith('image/')) {
        const decoded = await decodeQrFromFile(file);
        const token = decoded ? extractWalletInput(decoded) : null;
        if (token) { setInput(token); setAdding(true); }
        else setError('No wallet QR code was found in that image.');
        return;
      }
      const text = await file.text();
      const token = extractWalletInput(text);
      if (token) { setInput(token); setAdding(true); }
      else setError('No address, extended key or descriptor found in that file.');
    } catch {
      setError('Could not read that file.');
    }
  }

  function handleQrResult(payload: string) {
    setScanningQr(false);
    const token = extractWalletInput(payload);
    if (token) { setInput(token); setError(''); setAdding(true); }
    else setError('That QR code was not an address, extended key or descriptor.');
  }

  function handleRemove(id: string) {
    setWallets(removeWallet(id));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>WALLETS</span>
        <button
          type="button"
          onClick={() => { setAdding(a => !a); setError(''); }}
          aria-expanded={adding}
          className="rh-touch font-pixel tracking-widest cursor-pointer bg-transparent inline-flex items-center"
          style={{ fontSize: 10, padding: '6px 12px', border: '2px solid var(--alice-primary)', borderRadius: 2, color: 'var(--alice-primary)' }}
        >
          {adding ? 'CANCEL' : '+ ADD'}
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 px-4 py-3" style={{ border: '1px solid var(--alice-border)', borderRadius: 2 }}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Address, xpub / ypub / zpub, or a descriptor like wpkh(xpub.../<0;1>/*)"
            className="font-numbers outline-none w-full"
            style={{ fontSize: 13, padding: '8px 12px', backgroundColor: 'var(--alice-bg)', border: '2px solid var(--alice-primary)', borderRadius: 2, color: 'var(--alice-primary-dark)', boxSizing: 'border-box' }}
          />
          {/* Import helpers: from a file (text/JSON/image) or a scanned QR. */}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.json,application/json,text/plain,image/*"
              className="hidden"
              onChange={e => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="font-pixel tracking-widest cursor-pointer bg-transparent"
              style={{ fontSize: 10, padding: '7px 12px', border: '2px solid var(--alice-border)', borderRadius: 2, color: 'var(--alice-primary)' }}
            >
              IMPORT FILE
            </button>
            <button
              type="button"
              onClick={() => { setError(''); setScanningQr(true); }}
              disabled={!qrDecodingSupported()}
              className="font-pixel tracking-widest cursor-pointer bg-transparent disabled:cursor-not-allowed"
              style={{ fontSize: 10, padding: '7px 12px', border: '2px solid var(--alice-border)', borderRadius: 2, color: 'var(--alice-primary)', opacity: qrDecodingSupported() ? 1 : 0.4 }}
              title={qrDecodingSupported() ? 'Scan a QR with the camera' : 'QR scanning is not supported by this browser'}
            >
              SCAN QR
            </button>
          </div>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="font-numbers outline-none w-full"
            style={{ fontSize: 13, padding: '8px 12px', backgroundColor: 'var(--alice-bg)', border: '2px solid var(--alice-primary)', borderRadius: 2, color: 'var(--alice-primary-dark)', boxSizing: 'border-box' }}
          />
          {error && <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-danger)' }}>{error}</p>}
          <button
            type="button"
            onClick={() => void handleAdd()}
            className="font-pixel tracking-widest self-start cursor-pointer"
            style={{ fontSize: 10, padding: '8px 16px', borderRadius: 2, border: '2px solid var(--alice-primary)', backgroundColor: 'var(--alice-primary)', color: 'var(--alice-on-primary)' }}
          >
            ADD
          </button>
          <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.8 }}>
            Public keys and addresses only, stored on this device. An xpub reveals every address of the wallet, keep it private.
          </p>
        </div>
      )}

      {wallets.length === 0 && !adding && (
        <div style={{ border: '1px dashed var(--alice-border)', borderRadius: 2 }}>
          <EmptyState
            glyph="◇"
            title="No wallets yet"
            hint="Add an address, xpub or descriptor to watch it at a glance."
          />
        </div>
      )}

      {scanningQr && (
        <ExplorerQrScanner onResult={handleQrResult} onClose={() => setScanningQr(false)} />
      )}

      {wallets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {wallets.map(w => (
            <WalletCard
              key={w.id}
              wallet={w}
              scanning={scanning.has(w.id)}
              onOpen={() => (w.kind === 'address' ? onOpenAddress(w.input) : onOpenXpub(w.input, w.label, w.networkId))}
              onRemove={() => handleRemove(w.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
