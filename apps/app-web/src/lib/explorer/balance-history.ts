// Reconstructs an address's balance over time from its transactions. Pure: the
// component fetches, this turns the transaction list into a timeline it can draw.
//
// The series is anchored at the CURRENT balance and walked backward through the
// deltas, so it is correct at the right edge (today) even when only part of the
// history was loaded: the left edge is simply the oldest loaded point.

import type { NormalizedTransaction } from './types.ts';
import type { RequestOptions } from './provider.ts';
import { ChainDataError } from './provider.ts';

export type BalancePoint = { t: number; balanceSats: number };

export type BalanceSeries = {
  points: BalancePoint[];
  firstSeen: number | null;
  lastSeen: number | null;
};

/** Net effect of a transaction on this address: received minus spent, in sats. */
export function addressTxDelta(tx: NormalizedTransaction, address: string): number {
  let received = 0;
  let sent = 0;
  for (const o of tx.outputs) if (o.address === address) received += o.valueSats;
  for (const i of tx.inputs) if (i.address === address) sent += i.valueSats ?? 0;
  return received - sent;
}

/** Net effect of a transaction on a whole wallet: outputs paying any of the
 *  wallet's addresses, minus inputs spending any of them. */
export function walletTxDelta(tx: NormalizedTransaction, addresses: ReadonlySet<string>): number {
  let received = 0;
  let sent = 0;
  for (const o of tx.outputs) if (o.address && addresses.has(o.address)) received += o.valueSats;
  for (const i of tx.inputs) if (i.address && addresses.has(i.address)) sent += i.valueSats ?? 0;
  return received - sent;
}

/**
 * A balance timeline for a whole wallet, from the (deduplicated) transactions
 * touching any of its addresses. Same anchoring as the address version: correct
 * at today's edge, walked backward through the per-transaction wallet deltas.
 */
export function buildWalletBalanceSeries(
  txs: NormalizedTransaction[],
  addresses: ReadonlySet<string>,
  currentBalanceSats: number,
): BalanceSeries {
  // Deduplicate: one transaction can touch several wallet addresses.
  const byId = new Map<string, NormalizedTransaction>();
  for (const t of txs) byId.set(t.txid, t);

  const dated = [...byId.values()]
    .filter(t => t.status.confirmed && typeof t.status.blockTime === 'number')
    .map(t => ({ t: t.status.blockTime as number, delta: walletTxDelta(t, addresses) }))
    .sort((a, b) => a.t - b.t);

  if (dated.length === 0) return { points: [], firstSeen: null, lastSeen: null };

  const totalDelta = dated.reduce((s, d) => s + d.delta, 0);
  const start = currentBalanceSats - totalDelta;
  const points: BalancePoint[] = [{ t: dated[0].t, balanceSats: start }];
  let running = start;
  for (const d of dated) {
    running += d.delta;
    points.push({ t: d.t, balanceSats: running });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > dated[dated.length - 1].t) {
    points.push({ t: nowSec, balanceSats: currentBalanceSats });
  }
  return { points, firstSeen: dated[0].t, lastSeen: dated[dated.length - 1].t };
}

/** Downsample a balance series to a small fixed-size sparkline (sats). */
export function toSparkline(series: BalanceSeries, points = 24): number[] {
  if (series.points.length === 0) return [];
  if (series.points.length <= points) return series.points.map(p => p.balanceSats);
  const step = (series.points.length - 1) / (points - 1);
  return Array.from({ length: points }, (_, i) => series.points[Math.round(i * step)].balanceSats);
}

export type HistoryWalk = { txs: NormalizedTransaction[]; partial: boolean };

/** The wallet's (or address's) most recent confirmed movement: when, and the
 *  signed net effect in sats. Null when nothing dated was loaded. */
export function lastMovement(
  txs: NormalizedTransaction[],
  addresses: ReadonlySet<string> | string,
): { time: number; deltaSats: number } | null {
  // Deduplicate: one transaction can touch several wallet addresses.
  const byId = new Map<string, NormalizedTransaction>();
  for (const t of txs) byId.set(t.txid, t);
  let latest: NormalizedTransaction | null = null;
  for (const t of byId.values()) {
    if (!t.status.confirmed || typeof t.status.blockTime !== 'number') continue;
    if (!latest || (t.status.blockTime > (latest.status.blockTime as number))) latest = t;
  }
  if (!latest) return null;
  const deltaSats = typeof addresses === 'string'
    ? addressTxDelta(latest, addresses)
    : walletTxDelta(latest, addresses);
  return { time: latest.status.blockTime as number, deltaSats };
}

/**
 * Walk the paged transaction history of a set of addresses, bounded on both
 * axes so a busy wallet can never fan out into hundreds of requests. A failed
 * page just ends that address's walk (the series is anchored at today, so a
 * missing tail only shortens the left edge); a cancelled request propagates,
 * since the caller's view is gone.
 */
export async function collectHistoryTxs(
  getTxs: (address: string, afterTxid?: string, opts?: RequestOptions) => Promise<NormalizedTransaction[]>,
  addresses: string[],
  maxAddresses: number,
  maxTxs: number,
  request?: RequestOptions,
): Promise<HistoryWalk> {
  const toWalk = addresses.slice(0, maxAddresses);
  const txs: NormalizedTransaction[] = [];
  let partial = toWalk.length < addresses.length;
  for (const address of toWalk) {
    if (txs.length >= maxTxs) { partial = true; break; }
    let after: string | undefined;
    for (;;) {
      let page: NormalizedTransaction[];
      try {
        page = await getTxs(address, after, request);
      } catch (err) {
        if (err instanceof ChainDataError && err.code === 'aborted') throw err;
        partial = true;
        break;
      }
      if (page.length === 0) break;
      txs.push(...page);
      if (page.length < 25 || txs.length >= maxTxs) break;
      after = page[page.length - 1].txid;
    }
  }
  return { txs, partial };
}

export function buildBalanceSeries(
  txs: NormalizedTransaction[],
  address: string,
  currentBalanceSats: number,
): BalanceSeries {
  // Only confirmed transactions carry a block time; sort them oldest first.
  const dated = txs
    .filter(t => t.status.confirmed && typeof t.status.blockTime === 'number')
    .map(t => ({ t: t.status.blockTime as number, delta: addressTxDelta(t, address) }))
    .sort((a, b) => a.t - b.t);

  if (dated.length === 0) {
    return { points: [], firstSeen: null, lastSeen: null };
  }

  const totalDelta = dated.reduce((s, d) => s + d.delta, 0);
  // Balance just before the first loaded transaction.
  const start = currentBalanceSats - totalDelta;

  const points: BalancePoint[] = [{ t: dated[0].t, balanceSats: start }];
  let running = start;
  for (const d of dated) {
    running += d.delta;
    points.push({ t: d.t, balanceSats: running });
  }
  // Extend flat to the present so the line reaches today.
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > dated[dated.length - 1].t) {
    points.push({ t: nowSec, balanceSats: currentBalanceSats });
  }

  return { points, firstSeen: dated[0].t, lastSeen: dated[dated.length - 1].t };
}
