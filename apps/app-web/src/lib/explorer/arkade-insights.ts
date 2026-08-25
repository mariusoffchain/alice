// Pure adapters that let the Arkade (off-chain) data reuse the Bitcoin
// explorer's views: the bowtie flow graph for a virtual transaction, and the
// balance timeline for an address's VTXOs. No network here.

import type { ArkadeVirtualTx, ArkadeVtxo } from './arkade.ts';
import type { NormalizedOutspend, NormalizedTransaction } from './types.ts';
import type { BalanceSeries } from './balance-history.ts';

/**
 * A virtual Arkade transaction shaped as a NormalizedTransaction, so the
 * regular flow graph can draw it. Off-chain: no confirmation, no weight; the
 * fee is the visible input/output difference (usually zero on Arkade).
 */
export function virtualTxToNormalized(vtx: ArkadeVirtualTx, sourceBase: string): NormalizedTransaction {
  const inSum = vtx.inputs.reduce((s, i) => s + (i.amountSats ?? 0), 0);
  const outSum = vtx.outputs.reduce((s, o) => s + o.amountSats, 0);
  const allInputsKnown = vtx.inputs.every(i => i.amountSats !== undefined);
  return {
    txid: vtx.txid,
    version: 3,
    locktime: 0,
    sizeBytes: 0,
    weight: 0,
    vsize: 0,
    feeSats: allInputsKnown ? Math.max(0, inSum - outSum) : null,
    feeRateSatVb: null,
    status: { confirmed: false },
    inputs: vtx.inputs.map(i => ({
      prevTxid: i.txid,
      prevVout: i.vout,
      valueSats: i.amountSats,
      scriptType: 'p2tr',
      sequence: 0xffffffff,
      isCoinbase: false,
    })),
    outputs: vtx.outputs.map(o => ({
      index: o.index,
      valueSats: o.amountSats,
      scriptType: o.isAnchor ? undefined : 'p2tr',
      spent: o.vtxo ? o.vtxo.isSpent || o.vtxo.isSwept : undefined,
    })),
    isCoinbase: false,
    rbfSignaled: false,
    source: { name: 'Arkade ASP', baseUrl: sourceBase },
  };
}

/** Spend status per output, for the flow graph's spent indicators: a spent
 *  VTXO points at the checkpoint transaction that consumed it. */
export function virtualTxOutspends(vtx: ArkadeVirtualTx): NormalizedOutspend[] {
  return vtx.outputs.map(o => {
    const spent = o.vtxo ? o.vtxo.isSpent || o.vtxo.isSwept : false;
    return spent ? { spent: true, txid: o.vtxo?.spentBy, vin: 0 } : { spent: false };
  });
}

export type ArkadeBalanceHistory = BalanceSeries & {
  /** True when some spend could not be dated (its event is left out); the
   *  right edge stays correct, only the left edge absorbs the gap. */
  partial: boolean;
};

/** When the transaction that spent a VTXO could be dated: the creation time
 *  of a VTXO it produced on the same address (the usual change). */
function spendTimeOf(v: ArkadeVtxo, createdAtByTxid: ReadonlyMap<string, number>): number | undefined {
  return (v.arkTxid ? createdAtByTxid.get(v.arkTxid) : undefined)
    ?? (v.spentBy ? createdAtByTxid.get(v.spentBy) : undefined);
}

/**
 * The spendable-balance timeline of an Arkade address, from its VTXOs alone.
 * A VTXO credits the address at its creation time. A spent VTXO debits it at
 * the creation time of the transaction that spent it, recovered when that
 * spender created another VTXO on this same address (the usual change). A
 * spend with no dated spender is debited at the VTXO's own creation time
 * (netting it out instead of letting a dangling credit push the whole left
 * edge of the anchored series far below zero) and marks the series partial.
 * Like the on-chain series, the line is anchored at the CURRENT balance and
 * walked backward, so it is exact at today's edge.
 */
export function buildArkadeBalanceSeries(vtxos: ArkadeVtxo[], spendableSats: number): ArkadeBalanceHistory {
  const createdAtByTxid = new Map<string, number>();
  for (const v of vtxos) {
    if (v.createdAt !== undefined && !createdAtByTxid.has(v.txid)) createdAtByTxid.set(v.txid, v.createdAt);
  }

  let partial = false;
  const events: { t: number; delta: number }[] = [];
  for (const v of vtxos) {
    if (v.createdAt === undefined) { partial = true; continue; }
    events.push({ t: v.createdAt, delta: v.amountSats });
    if (v.isSpent || v.isSwept) {
      const spendTime = spendTimeOf(v, createdAtByTxid);
      if (spendTime === undefined) partial = true;
      events.push({ t: spendTime ?? v.createdAt, delta: -v.amountSats });
    }
  }
  events.sort((a, b) => a.t - b.t);
  if (events.length === 0) return { points: [], firstSeen: null, lastSeen: null, partial };

  const totalDelta = events.reduce((s, e) => s + e.delta, 0);
  let running = spendableSats - totalDelta;
  const points = [{ t: events[0].t, balanceSats: running }];
  for (const e of events) {
    running += e.delta;
    points.push({ t: e.t, balanceSats: running });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > events[events.length - 1].t) points.push({ t: nowSec, balanceSats: spendableSats });
  return { points, firstSeen: events[0].t, lastSeen: events[events.length - 1].t, partial };
}

/** One transaction's net effect on an Arkade address, for its history list. */
export type ArkadeAddressTxEvent = {
  /** The Arkade transaction that touched the address. */
  txid: string;
  /** When it happened; undefined when it could not be dated. */
  time?: number;
  /** Net effect on the address, in sats (received minus spent). */
  deltaSats: number;
};

/**
 * The address's transaction history, reconstructed from its VTXOs: the
 * transaction that created a VTXO credits the address, the transaction that
 * spent one debits it, and a transaction doing both (spend with change) nets
 * out into a single entry. Newest first; undatable entries close the list.
 */
export function buildArkadeTxHistory(vtxos: ArkadeVtxo[]): ArkadeAddressTxEvent[] {
  const createdAtByTxid = new Map<string, number>();
  for (const v of vtxos) {
    if (v.createdAt !== undefined && !createdAtByTxid.has(v.txid)) createdAtByTxid.set(v.txid, v.createdAt);
  }

  const events = new Map<string, ArkadeAddressTxEvent>();
  const touch = (txid: string, time: number | undefined, delta: number) => {
    const e = events.get(txid) ?? { txid, time, deltaSats: 0 };
    e.deltaSats += delta;
    if (e.time === undefined) e.time = time;
    events.set(txid, e);
  };
  for (const v of vtxos) {
    touch(v.txid, v.createdAt, v.amountSats);
    if (v.isSpent || v.isSwept) {
      const spender = v.arkTxid ?? v.spentBy;
      if (spender) touch(spender, spendTimeOf(v, createdAtByTxid), -v.amountSats);
    }
  }
  return [...events.values()].sort((a, b) => (b.time ?? -1) - (a.time ?? -1));
}
