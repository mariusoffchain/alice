// Identifying Arkade settlements on the Bitcoin chain.
//
// A commitment (settlement) transaction is a plain Bitcoin transaction: nothing
// in its on-chain shape says "Arkade". The ASP's indexer is the oracle: asking
// it for a commitment by txid answers with the round for a settlement and
// "batch not found" for anything else. The ASP publishes no historical list
// (its /v1/txs stream is live-only), but every commitment funds itself from the
// operator's previous change output, so the settlements form one on-chain spend
// chain: from any known commitment we can walk forward (via outspends) to the
// tip, and backward (via the first input) into history.
//
// The registry below accumulates every settlement this browser has identified,
// persisted in localStorage, so the ribbon and the block view can highlight
// them without re-walking the chain from scratch each session.

import { getArkadeCommitmentIfAny } from './arkade.ts';
import type { NormalizedOutspend, NormalizedTransaction } from './types.ts';
import type { RequestOptions } from './provider.ts';

/** One settlement identified on-chain. Height/time absent until confirmed. */
export type KnownSettlement = {
  txid: string;
  height?: number;
  timestamp?: number;
};

// The chain walk needs a starting point, since the ASP serves no history. This
// is a real commitment of the arkade.computer ASP (mainnet), identified by
// following a VTXO's commitmentTxids and confirmed against the indexer; the
// walker extends forward from here to the live tip, and backward for history.
export const SEED_SETTLEMENT_TXID = '086f74e380432214902bc8d7e24d3eb57ba97b9b36811cec10ee44e3c7bcf12b';

const STORAGE_KEY = 'alice_arkade_settlements_v1';
// The persisted registry is capped so a long-lived browser profile does not
// grow without bound; the oldest settlements fall off first.
const MAX_STORED = 500;

/** Minimal storage the registry persists through; injectable for tests. */
export type KVStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): KVStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The set of settlements this browser knows about, persisted and observable.
 * One module-level instance is shared by the ribbon, the tx view and the block
 * view, so a settlement identified anywhere highlights everywhere.
 */
export class SettlementRegistry {
  private byTxid = new Map<string, KnownSettlement>();
  private listeners = new Set<() => void>();
  private storage: KVStorage | null;
  private loaded = false;

  constructor(storage?: KVStorage | null) {
    this.storage = storage === undefined ? defaultStorage() : storage;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return;
      for (const e of arr) {
        const s = e as Partial<KnownSettlement>;
        if (typeof s.txid === 'string' && /^[0-9a-f]{64}$/.test(s.txid)) {
          this.byTxid.set(s.txid, {
            txid: s.txid,
            height: typeof s.height === 'number' ? s.height : undefined,
            timestamp: typeof s.timestamp === 'number' ? s.timestamp : undefined,
          });
        }
      }
    } catch { /* a corrupt cache just starts empty */ }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      // Keep the newest by height (unconfirmed ones, without a height, stay).
      const all = [...this.byTxid.values()];
      const confirmed = all.filter(s => s.height !== undefined)
        .sort((a, b) => b.height! - a.height!)
        .slice(0, MAX_STORED);
      const pending = all.filter(s => s.height === undefined);
      this.storage.setItem(STORAGE_KEY, JSON.stringify([...confirmed, ...pending]));
    } catch { /* quota or private mode: stay in-memory */ }
  }

  /** Every known settlement, unordered. */
  all(): KnownSettlement[] {
    this.load();
    return [...this.byTxid.values()];
  }

  has(txid: string): boolean {
    this.load();
    return this.byTxid.has(txid);
  }

  get(txid: string): KnownSettlement | undefined {
    this.load();
    return this.byTxid.get(txid);
  }

  /** The confirmed settlement heights, for the ribbon's block highlights. */
  heights(): Set<number> {
    this.load();
    const s = new Set<number>();
    for (const e of this.byTxid.values()) if (e.height !== undefined) s.add(e.height);
    return s;
  }

  /** Add or enrich a settlement; notifies only when something changed. */
  add(s: KnownSettlement): void {
    this.load();
    const prev = this.byTxid.get(s.txid);
    const next: KnownSettlement = {
      txid: s.txid,
      height: s.height ?? prev?.height,
      timestamp: s.timestamp ?? prev?.timestamp,
    };
    if (prev && prev.height === next.height && prev.timestamp === next.timestamp) return;
    this.byTxid.set(s.txid, next);
    this.persist();
    for (const l of this.listeners) l();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

/** The shared instance the Explorer UI uses. */
export const settlementRegistry = new SettlementRegistry();

/** Record a settlement announced by the live stream (height still unknown). */
export function noteSeenSettlement(txid: string): void {
  if (/^[0-9a-f]{64}$/i.test(txid)) settlementRegistry.add({ txid: txid.toLowerCase() });
}

// ---------------------------------------------------------------------------
// Chain walking

/** The slice of ChainDataProvider the walker needs; injectable for tests. */
export type ChainReader = {
  getTransaction(txid: string, opts?: RequestOptions): Promise<NormalizedTransaction>;
  getOutspends?(txid: string, opts?: RequestOptions): Promise<NormalizedOutspend[]>;
};

/** Answers with the round when the txid is a commitment, null otherwise. */
export type CommitmentProbe = (txid: string, signal?: AbortSignal) => Promise<boolean>;

/** The default probe: ask the ASP indexer. Non-commitments are remembered so a
 *  txid is never re-checked; commitments land in the registry via the walker. */
export function makeAspProbe(arkApiUrl: string, negatives: Set<string> = new Set()): CommitmentProbe {
  return async (txid, signal) => {
    if (settlementRegistry.has(txid)) return true;
    if (negatives.has(txid)) return false;
    const c = await getArkadeCommitmentIfAny(arkApiUrl, txid, { signal });
    if (c === null) { negatives.add(txid); return false; }
    return true;
  };
}

const BULK: RequestOptions['priority'] = 'bulk';

/** Fetch a settlement's confirmation and record it in the registry. */
async function recordSettlement(chain: ChainReader, txid: string, signal?: AbortSignal): Promise<NormalizedTransaction> {
  const tx = await chain.getTransaction(txid, { signal, priority: BULK });
  settlementRegistry.add({
    txid,
    height: tx.status.confirmed ? tx.status.blockHeight : undefined,
    timestamp: tx.status.confirmed ? tx.status.blockTime : undefined,
  });
  return tx;
}

export type WalkResult = {
  /** Newly identified settlements, in discovery order. */
  found: string[];
  /** True when the walk stopped because a lookup failed (retryable later). */
  interrupted: boolean;
};

/**
 * Walk the funding chain FORWARD from a known settlement to the live tip: each
 * commitment's change output is spent by the next commitment, so we follow each
 * spent output's spender and keep whichever the ASP confirms as a commitment.
 * Stops at the first commitment whose outputs no next commitment spends (the
 * tip), or after `maxHops`.
 */
export async function walkSettlementsForward(
  chain: ChainReader,
  probe: CommitmentProbe,
  fromTxid: string,
  opts: { signal?: AbortSignal; maxHops?: number } = {},
): Promise<WalkResult> {
  const { signal, maxHops = 200 } = opts;
  const found: string[] = [];
  if (typeof chain.getOutspends !== 'function') return { found, interrupted: false };
  let cur = fromTxid;
  try {
    await recordSettlement(chain, cur, signal);
    for (let hop = 0; hop < maxHops; hop++) {
      const outspends = await chain.getOutspends(cur, { signal, priority: BULK });
      // The change output's spender is the next commitment; the other outputs'
      // spenders (batch sweeps, connector spends) are not, and the probe tells
      // them apart. Dedupe: several outputs can be spent by one transaction.
      const spenders = [...new Set(outspends.filter(o => o.spent && o.txid).map(o => o.txid!))]
        .filter(t => t !== cur);
      let next: string | null = null;
      for (const s of spenders) {
        if (await probe(s, signal)) { next = s; break; }
      }
      if (!next) return { found, interrupted: false };
      await recordSettlement(chain, next, signal);
      found.push(next);
      cur = next;
    }
  } catch {
    // Aborted or a provider hiccup: keep what was found, retry on a later walk.
    return { found, interrupted: true };
  }
  return { found, interrupted: false };
}

/**
 * Walk the funding chain BACKWARD from a known settlement into history: each
 * commitment's first input spends the previous commitment's change. Stops when
 * the parent is not a commitment (the operator's original funding), or after
 * `maxHops` — deep history is discovered progressively, a page per walk.
 */
export async function walkSettlementsBackward(
  chain: ChainReader,
  probe: CommitmentProbe,
  fromTxid: string,
  opts: { signal?: AbortSignal; maxHops?: number } = {},
): Promise<WalkResult> {
  const { signal, maxHops = 25 } = opts;
  const found: string[] = [];
  let cur = fromTxid;
  try {
    for (let hop = 0; hop < maxHops; hop++) {
      const tx = await chain.getTransaction(cur, { signal, priority: BULK });
      const prev = tx.inputs[0]?.prevTxid;
      if (!prev || tx.inputs[0]?.isCoinbase) return { found, interrupted: false };
      if (!(await probe(prev, signal))) return { found, interrupted: false };
      await recordSettlement(chain, prev, signal);
      found.push(prev);
      cur = prev;
    }
  } catch {
    return { found, interrupted: true };
  }
  return { found, interrupted: false };
}

/**
 * One full update pass, as the Explorer runs it: seed the registry, extend
 * forward to the live tip from the newest known settlement, resolve any
 * heights the live stream left unknown, and page a little further back into
 * history. Each step tolerates failure independently.
 */
export async function updateSettlements(
  chain: ChainReader,
  arkApiUrl: string,
  opts: { signal?: AbortSignal; backwardHops?: number } = {},
): Promise<void> {
  const { signal, backwardHops = 25 } = opts;
  const probe = makeAspProbe(arkApiUrl);
  settlementRegistry.add({ txid: SEED_SETTLEMENT_TXID });

  const known = settlementRegistry.all();
  // Resolve heights the live stream could not know (a few at most per pass).
  for (const s of known.filter(x => x.height === undefined).slice(0, 10)) {
    try { await recordSettlement(chain, s.txid, signal); } catch { /* later pass */ }
  }

  const confirmed = settlementRegistry.all().filter(s => s.height !== undefined);
  const newest = confirmed.reduce((a, b) => (a.height! >= b.height! ? a : b), confirmed[0]);
  const oldest = confirmed.reduce((a, b) => (a.height! <= b.height! ? a : b), confirmed[0]);
  if (newest) await walkSettlementsForward(chain, probe, newest.txid, { signal });
  if (oldest && backwardHops > 0) await walkSettlementsBackward(chain, probe, oldest.txid, { signal, maxHops: backwardHops });
}
