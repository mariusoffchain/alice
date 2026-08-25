// Scan a wallet's derived addresses on-chain. Walks each chain (receive, then
// change) by index, fetching address stats through the ChainDataProvider, and
// stops a chain once it has seen `gapLimit` unused addresses in a row (BIP44's
// gap limit). The provider is the CachingProvider, so the many small lookups
// are de-duplicated and rate-limited, never a burst.
//
// Pure orchestration: no derivation maths (that is wallet-derive), no UI.

import type { ChainDataProvider, RequestOptions } from './provider.ts';
import { ChainDataError } from './provider.ts';
import type { AddressStats } from './signals.ts';
import type { AddressUtxo } from './address-insights.ts';
// Only the TYPE is imported statically: the derivation library (bitcoinjs-lib
// and the descriptors engine, ~0.5 MB) is pulled in lazily inside scanWallet,
// so it never weighs on the first render of pages that show no wallet.
import type { deriveChain as DeriveChainFn, WalletDescriptor } from './wallet-derive.ts';

/** The standard external/internal chains. */
export type ChainIndex = 0 | 1;

export type DerivedAddress = {
  chain: ChainIndex;
  index: number;
  address: string;
  stats: AddressStats;
};

export type WalletUtxo = AddressUtxo & { address: string };

export type WalletScan = {
  descriptor: WalletDescriptor;
  /** Used addresses only (txCount > 0), in derivation order. */
  receive: DerivedAddress[];
  change: DerivedAddress[];
  /** Confirmed spendable balance across every used address. */
  balanceSats: number;
  /** Sum of per-address transaction counts: a rough activity measure, not a
   *  distinct-tx count (a tx touching two of our addresses is counted twice). */
  txTotal: number;
  usedCount: number;
  /** Present when UTXOs were requested; a flat list for the bubble diagram. */
  utxos?: WalletUtxo[];
  /** Some address stats could not be fetched, so the totals may understate. */
  degraded: boolean;
  /** A chain hit the address cap before its gap limit, so it may be truncated. */
  reachedCap: boolean;
  /** The scan stopped early because the endpoint was rate-limiting the lookups. */
  throttled: boolean;
};

export type ScanProgress = {
  /** Addresses whose stats have been fetched so far, across both chains. */
  scanned: number;
  /** Used addresses found so far. */
  used: number;
};

/** A snapshot of the scan so far, streamed after each window so the dashboard
 *  can paint early and update as the walk progresses. */
export type WalletScanPartial = {
  receive: DerivedAddress[];
  change: DerivedAddress[];
  balanceSats: number;
  txTotal: number;
  usedCount: number;
  scanned: number;
};

export type ScanOptions = {
  gapLimit?: number;
  /** Hard cap per chain, so a pathological wallet cannot scan forever. */
  maxAddresses?: number;
  /** Also fetch UTXOs for funded addresses (for the bubble diagram). */
  includeUtxos?: boolean;
  /** Called after each window, so the UI can show live progress. */
  onProgress?: (p: ScanProgress) => void;
  /** Called after each window with the running totals and the used addresses
   *  found so far, so the dashboard can render long before the scan ends. */
  onPartial?: (p: WalletScanPartial) => void;
  /** Overall wall-clock budget; the scan bails (throttled) once exceeded, so a
   *  stalling endpoint can never leave the view frozen indefinitely. */
  deadlineMs?: number;
  /** Cancels the scan (view closed); rejects with ChainDataError 'aborted'. */
  signal?: AbortSignal;
};

const DEFAULT_GAP_LIMIT = 20;
const DEFAULT_MAX_ADDRESSES = 200;
// Addresses fetched per window. Smaller than the gap limit on purpose: each
// window streams a partial update, so the dashboard refreshes address by ten
// addresses instead of waiting a full gap-limit batch.
const SCAN_WINDOW = 10;
const DEFAULT_DEADLINE_MS = 30_000;
// A scan is a bulk walk of many addresses: give up on a stalling lookup well
// before the interactive 15s cap, and let the gate rank it below the UI.
const BULK_TIMEOUT_MS = 8_000;
// When this many consecutive windows come back entirely un-fetchable, the
// endpoint is throttling us; stop grinding and report a degraded scan instead
// of hanging on hundreds of doomed requests.
const MAX_FAILED_WINDOWS = 3;

async function scanChain(
  descriptor: string,
  chain: ChainIndex,
  network: WalletDescriptor['network'],
  provider: ChainDataProvider,
  deriveChain: typeof DeriveChainFn,
  gapLimit: number,
  maxAddresses: number,
  deadline: number,
  request: RequestOptions,
  callerSignal: AbortSignal | undefined,
  report: (fetchedInWindow: number, usedTotalDelta: number, usedSnapshot: DerivedAddress[]) => void,
): Promise<{ used: DerivedAddress[]; degraded: boolean; reachedCap: boolean; throttled: boolean }> {
  const used: DerivedAddress[] = [];
  let degraded = false;
  let throttled = false;
  let trailingGap = 0;
  let index = 0;
  let failedWindows = 0;

  // Fetch a window (one gap-limit wide) at a time: the provider bounds the real
  // concurrency, so this stays polite while making progress in chunks.
  while (index < maxAddresses && trailingGap < gapLimit) {
    // A cancelled scan stops dead: the caller's view is gone.
    if (callerSignal?.aborted) throw new ChainDataError('aborted', 'The scan was cancelled.');
    // Stop if we have blown the overall time budget (a stalling endpoint).
    if (Date.now() >= deadline) { throttled = true; degraded = true; break; }
    const windowSize = Math.min(SCAN_WINDOW, maxAddresses - index);
    const window = deriveChain(descriptor, index, windowSize, network);
    const results = await Promise.all(
      window.map(async ({ index: i, address }) => {
        try {
          return { i, address, stats: await provider.getAddressStats(address, request) };
        } catch (err) {
          // Only the CALLER's abort ends the scan: an 'aborted' fired by the
          // deadline signal is just this lookup running out of time budget,
          // and reads as one more failed (unknown) address.
          if (err instanceof ChainDataError && err.code === 'aborted' && callerSignal?.aborted) throw err;
          degraded = true;
          return { i, address, stats: null };
        }
      }),
    );
    let anyFetched = false;
    let usedDelta = 0;
    for (const { i, address, stats } of results) {
      if (!stats) continue; // a failed lookup is unknown, not a confirmed gap
      anyFetched = true;
      if (stats.txCount > 0) {
        used.push({ chain, index: i, address, stats });
        usedDelta += 1;
        trailingGap = 0;
      } else {
        // Only a successful, unused address counts toward the gap limit, so a
        // window of failures never masquerades as the end of the wallet.
        trailingGap += 1;
      }
    }
    index += windowSize;
    report(windowSize, usedDelta, [...used]);

    // Bail out early if the endpoint is hard-throttling: several windows in a
    // row returning nothing means retrying more addresses is pointless.
    failedWindows = anyFetched ? 0 : failedWindows + 1;
    if (failedWindows >= MAX_FAILED_WINDOWS) { throttled = true; break; }
  }

  return { used, degraded, reachedCap: index >= maxAddresses && trailingGap < gapLimit, throttled };
}

/**
 * Scan a parsed wallet: walk receive and (when present) change, aggregate the
 * balance and activity, and optionally collect UTXOs. Never throws for a chain
 * hiccup; a failed lookup sets `degraded` and the scan continues.
 */
export async function scanWallet(
  descriptor: WalletDescriptor,
  provider: ChainDataProvider,
  opts: ScanOptions = {},
): Promise<WalletScan> {
  const gapLimit = Math.max(1, opts.gapLimit ?? DEFAULT_GAP_LIMIT);
  const maxAddresses = Math.max(gapLimit, opts.maxAddresses ?? DEFAULT_MAX_ADDRESSES);
  const deadlineMs = Math.max(1, opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const deadline = Date.now() + deadlineMs;
  // Every lookup of the scan is bulk traffic: it queues behind interactive
  // requests, gives up faster on a stalling endpoint, and dies with the view.
  // The deadline rides the abort signal too, so when the budget is blown every
  // in-flight and queued lookup dies AT ONCE, instead of the current window
  // grinding through retries and failovers for minutes on a hostile endpoint.
  const deadlineSignal = AbortSignal.timeout(deadlineMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadlineSignal]) : deadlineSignal;
  const request: RequestOptions = { signal, priority: 'bulk', timeoutMs: BULK_TIMEOUT_MS };
  // Lazy: pulls in the heavy derivation library only when a scan actually runs.
  const { deriveChain } = await import('./wallet-derive.ts');

  // Cumulative progress across both chains, streamed to the caller. Each
  // window also streams a full snapshot (used addresses + running totals), so
  // the dashboard can paint from the very first window and refresh as it goes.
  let scanned = 0;
  let usedSoFar = 0;
  let receivePartial: DerivedAddress[] = [];
  let changePartial: DerivedAddress[] = [];
  const emitPartial = () => {
    const all = [...receivePartial, ...changePartial];
    opts.onPartial?.({
      receive: receivePartial,
      change: changePartial,
      balanceSats: all.reduce((s, a) => s + Math.max(0, a.stats.fundedSum - a.stats.spentSum), 0),
      txTotal: all.reduce((s, a) => s + a.stats.txCount, 0),
      usedCount: all.length,
      scanned,
    });
  };
  const reportFor = (chain: ChainIndex) => (fetchedInWindow: number, usedDelta: number, usedSnapshot: DerivedAddress[]) => {
    scanned += fetchedInWindow;
    usedSoFar += usedDelta;
    if (chain === 0) receivePartial = usedSnapshot;
    else changePartial = usedSnapshot;
    opts.onProgress?.({ scanned, used: usedSoFar });
    emitPartial();
  };

  const receiveScan = await scanChain(descriptor.receive, 0, descriptor.network, provider, deriveChain, gapLimit, maxAddresses, deadline, request, opts.signal, reportFor(0));
  // If the endpoint already throttled us on the receive chain, don't hammer it
  // further with the change chain; report what we have.
  const changeScan = descriptor.change && !receiveScan.throttled
    ? await scanChain(descriptor.change, 1, descriptor.network, provider, deriveChain, gapLimit, maxAddresses, deadline, request, opts.signal, reportFor(1))
    : { used: [] as DerivedAddress[], degraded: false, reachedCap: false, throttled: false };

  const all = [...receiveScan.used, ...changeScan.used];
  const balanceSats = all.reduce((s, a) => s + Math.max(0, a.stats.fundedSum - a.stats.spentSum), 0);
  const txTotal = all.reduce((s, a) => s + a.stats.txCount, 0);

  let utxos: WalletUtxo[] | undefined;
  let degraded = receiveScan.degraded || changeScan.degraded;
  if (opts.includeUtxos && typeof provider.getAddressUtxos === 'function') {
    const funded = all.filter(a => a.stats.fundedSum - a.stats.spentSum > 0);
    const fetchUtxos = provider.getAddressUtxos.bind(provider);
    const lists = await Promise.all(
      funded.map(async (a) => {
        try {
          return (await fetchUtxos(a.address, request)).map(u => ({ ...u, address: a.address }));
        } catch (err) {
          if (err instanceof ChainDataError && err.code === 'aborted' && opts.signal?.aborted) throw err;
          degraded = true;
          return [] as WalletUtxo[];
        }
      }),
    );
    utxos = lists.flat();
  }

  return {
    descriptor,
    receive: receiveScan.used,
    change: changeScan.used,
    balanceSats,
    txTotal,
    usedCount: all.length,
    utxos,
    degraded,
    reachedCap: receiveScan.reachedCap || changeScan.reachedCap,
    throttled: receiveScan.throttled || changeScan.throttled,
  };
}
