// The interface every chain data source implements. Keeps Explorer free of
// any single provider, so a self-hosted Esplora or a personal node can be
// swapped in later without touching the UI or the analysis engine.

import type {
  BlockAudit,
  BlockTxSummary,
  DataSource,
  NormalizedBlock,
  NormalizedOutspend,
  NormalizedTransaction,
  ProjectedBlock,
} from './types.ts';
import type { AddressStats } from './signals.ts';
import type { AddressUtxo } from './address-insights.ts';

export type ChainDataErrorCode =
  | 'invalid-input'  // the id is malformed, never sent over the network
  | 'not-found'      // the provider has no such transaction
  | 'network'        // the provider could not be reached
  | 'backend'        // the provider answered with an error or garbage
  | 'aborted';       // the caller cancelled the request (tab closed, view left)

/** How urgent a request is. Interactive requests (a tab opening, the ribbon)
 *  jump ahead of bulk ones (a whole-wallet scan, a history walk) in the
 *  concurrency gate, so a heavy background scan never freezes the UI. */
export type RequestPriority = 'interactive' | 'bulk';

/** Per-call options, accepted by every provider method. All optional: a bare
 *  call is an interactive, non-cancellable request with the default timeout. */
export type RequestOptions = {
  /** Cancels the request; aborted calls reject with ChainDataError 'aborted'. */
  signal?: AbortSignal;
  priority?: RequestPriority;
  /** Overrides the provider's fetch timeout, e.g. shorter for bulk lookups. */
  timeoutMs?: number;
};

// A typed error so the UI can phrase each failure precisely, mirroring the
// per-domain error classes already used across wallet-core and alice-ai.
export class ChainDataError extends Error {
  readonly code: ChainDataErrorCode;
  constructor(code: ChainDataErrorCode, message: string) {
    super(message);
    this.name = 'ChainDataError';
    this.code = code;
  }
}

export interface ChainDataProvider {
  readonly source: DataSource;
  getTransaction(txid: string, opts?: RequestOptions): Promise<NormalizedTransaction>;
  /** On-chain stats for an address, used to judge historical reuse. */
  getAddressStats(address: string, opts?: RequestOptions): Promise<AddressStats>;
  /** A page of an address's transactions, newest first; `afterTxid` pages back. Optional. */
  getAddressTxs?(address: string, afterTxid?: string, opts?: RequestOptions): Promise<NormalizedTransaction[]>;
  /** The address's current unspent outputs, for coin-age. Optional. */
  getAddressUtxos?(address: string, opts?: RequestOptions): Promise<AddressUtxo[]>;
  /** Spend status of each output, indexed by vout. Optional: a provider without
   *  an outspends endpoint simply leaves the graph without spent indicators. */
  getOutspends?(txid: string, opts?: RequestOptions): Promise<NormalizedOutspend[]>;
  /** Confirmed blocks, newest first. With `beforeHeight`, returns the batch
   *  ending at that height (to page backwards). Optional. */
  getRecentBlocks?(beforeHeight?: number, opts?: RequestOptions): Promise<NormalizedBlock[]>;
  /** Projected mempool blocks, next-to-mine first. Optional. */
  getMempoolBlocks?(opts?: RequestOptions): Promise<ProjectedBlock[]>;
  /** A single block by height or hash. Optional. */
  getBlock?(heightOrHash: string, opts?: RequestOptions): Promise<NormalizedBlock>;
  /** A page of a block's transactions (25 per call), from `startIndex`. Optional. */
  getBlockTxs?(hash: string, startIndex: number, opts?: RequestOptions): Promise<NormalizedTransaction[]>;
  /** Lightweight summary of every transaction in a block, in one call, for the
   *  treemap. Optional (mempool's summary endpoint). */
  getBlockSummary?(hash: string, opts?: RequestOptions): Promise<BlockTxSummary[]>;
  /** The block audit (expected template vs actual), or null when not audited.
   *  Optional (mempool's audit endpoint). */
  getBlockAudit?(hash: string, opts?: RequestOptions): Promise<BlockAudit | null>;
}
