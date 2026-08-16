// Orchestrates a privacy analysis over a normalized transaction: gathers the
// on-chain facts the detectors need, runs them, and returns the signals. The
// detectors stay pure; only this layer touches the network.

import type { ChainDataProvider, RequestOptions } from './provider.ts';
import { ChainDataError } from './provider.ts';
import type { NormalizedTransaction } from './types.ts';
import type { NormalizedTransaction as NTx } from './types.ts';
import { detectAddressReuse, type AddressStats, type PrivacySignal } from './signals.ts';
import { detectPeelChain, detectPostmix, detectTransactionHeuristics, isCoinjoinLike, isPeelShape } from './heuristics.ts';

// Postmix detection needs the parent transactions; cap how many we fetch so a
// many-input tx cannot fan out into unbounded lookups.
const MAX_PARENT_LOOKUPS = 20;

// A tx with a huge number of distinct addresses (a big batch payout) would mean
// as many address lookups. Cap the historical enrichment; the intra-transaction
// ground still applies to every address regardless.
const MAX_ADDRESS_LOOKUPS = 40;

export type AnalysisResult = {
  signals: PrivacySignal[];
  /** True when some address history could not be fetched, so absence of a
   *  historical-reuse signal is not a guarantee. */
  degraded: boolean;
  /** True when the address count exceeded the lookup cap. */
  capped: boolean;
};

function uniqueAddresses(tx: NormalizedTransaction): string[] {
  const set = new Set<string>();
  for (const i of tx.inputs) if (i.address) set.add(i.address);
  for (const o of tx.outputs) if (o.address) set.add(o.address);
  return [...set];
}

export async function analyzeTransaction(
  tx: NormalizedTransaction,
  provider: ChainDataProvider,
  opts: { signal?: AbortSignal } = {},
): Promise<AnalysisResult> {
  const addresses = uniqueAddresses(tx);
  const capped = addresses.length > MAX_ADDRESS_LOOKUPS;
  const toLookup = capped ? addresses.slice(0, MAX_ADDRESS_LOOKUPS) : addresses;

  // The enrichment fan-out (up to 60 lookups) is bulk traffic: it queues
  // behind interactive requests and dies with the tab that asked for it.
  const request: RequestOptions = { signal: opts.signal, priority: 'bulk', timeoutMs: 8_000 };
  const rethrowAborted = (err: unknown) => {
    if (err instanceof ChainDataError && err.code === 'aborted') throw err;
  };

  const statsByAddress = new Map<string, AddressStats>();
  let degraded = capped;

  await Promise.all(
    toLookup.map(async (addr) => {
      try {
        statsByAddress.set(addr, await provider.getAddressStats(addr, request));
      } catch (err) {
        rethrowAborted(err);
        degraded = true;
      }
    }),
  );

  // Fetch the parent transactions once (bounded) and reuse them for both postmix
  // (a parent that is a CoinJoin) and the peel chain (a parent that is peel-shaped).
  const parentTxids = [...new Set(tx.inputs.filter(i => !i.isCoinbase).map(i => i.prevTxid))].slice(0, MAX_PARENT_LOOKUPS);
  const parents = new Map<string, NTx>();
  if (typeof provider.getTransaction === 'function') {
    await Promise.all(parentTxids.map(async (txid) => {
      try {
        parents.set(txid, await provider.getTransaction(txid, request));
      } catch (err) {
        rethrowAborted(err);
        degraded = true;
      }
    }));
  }
  const postmixInputs = tx.inputs.filter(i => !i.isCoinbase && (() => { const p = parents.get(i.prevTxid); return p ? isCoinjoinLike(p) : false; })()).length;

  // Peel chain: confirm one hop back (the parent is peel-shaped) and one hop
  // forward (a child spending our output is peel-shaped and fed solely by us).
  let parentPeelLinked = false, childPeelLinked = false;
  if (isPeelShape(tx)) {
    const parentId = tx.inputs.find(i => !i.isCoinbase)?.prevTxid;
    const parent = parentId ? parents.get(parentId) : undefined;
    if (parent && isPeelShape(parent)) parentPeelLinked = true;
    if (typeof provider.getOutspends === 'function' && typeof provider.getTransaction === 'function') {
      try {
        const spent = (await provider.getOutspends(tx.txid, request)).find(o => o.spent && o.txid);
        if (spent?.txid) {
          const child = await provider.getTransaction(spent.txid, request);
          if (isPeelShape(child) && child.inputs.find(i => !i.isCoinbase)?.prevTxid === tx.txid) childPeelLinked = true;
        }
      } catch (err) {
        rethrowAborted(err);
        degraded = true;
      }
    }
  }

  // Reuse, postmix and peel need the fetched context; the other heuristics are
  // pure and read the tx alone.
  const signals = [
    ...detectAddressReuse(tx, statsByAddress),
    ...detectTransactionHeuristics(tx),
    ...detectPostmix(tx, postmixInputs),
    ...detectPeelChain(tx, { parentPeelLinked, childPeelLinked }),
  ];
  return { signals, degraded, capped };
}
