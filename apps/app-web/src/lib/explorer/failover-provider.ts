// Automatic failover across public endpoints, so a first-time visitor on the
// default configuration gets a working explorer even while mempool.space is
// rate-limiting their IP. Design constraints:
//
//   - Privacy first: on the happy path EVERY query goes to the primary. A
//     fallback only ever sees traffic while the primary is failing, so using
//     the app does not spread addresses across third parties by default.
//   - A failing endpoint is penalized for a cooldown window: once the primary
//     starts throwing 429s, requests go straight to the fallback instead of
//     eating a doomed round-trip each time. After the cooldown the primary is
//     tried again (penalties are per endpoint, in memory).
//   - Only transient failures ('backend', 'network') fail over. 'not-found'
//     and 'invalid-input' are real answers; 'aborted' means the caller left.
//   - Bare Esplora fallbacks (esploraOnly) are excluded from the mempool-/v1
//     endpoints they do not serve (projected blocks, block summary, audit...).
//
// Sits UNDER the CachingProvider: caching, priorities and retry backoff wrap
// this, so a retry after backoff naturally lands on the healthiest endpoint.

import type { ChainDataProvider, RequestOptions } from './provider.ts';
import { ChainDataError } from './provider.ts';
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

/** How long a failing endpoint sits out before being tried again. */
const DEFAULT_COOLDOWN_MS = 45_000;

export type FailoverEndpoint = {
  provider: ChainDataProvider;
  /** A bare Esplora instance: no /v1 mempool API (fees, summary, audit...). */
  esploraOnly?: boolean;
};

export type FailoverOptions = {
  cooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
};

function isFailoverable(err: unknown): boolean {
  return err instanceof ChainDataError && (err.code === 'backend' || err.code === 'network');
}

type Tracked = FailoverEndpoint & { penalizedUntil: number };

export class FailoverProvider implements ChainDataProvider {
  readonly source: DataSource;
  private readonly endpoints: Tracked[];
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(endpoints: FailoverEndpoint[], opts: FailoverOptions = {}) {
    if (endpoints.length === 0) throw new Error('FailoverProvider needs at least one endpoint.');
    this.endpoints = endpoints.map(e => ({ ...e, penalizedUntil: 0 }));
    // The wrapper speaks for the primary: that is where queries go by default.
    this.source = endpoints[0].provider.source;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Healthy endpoints first (in declared order), then penalized ones by the
   *  soonest to recover: when everything is penalized we still try, degraded
   *  beats dead. */
  private ranked(esploraCompatible: boolean): Tracked[] {
    const eligible = this.endpoints.filter(e => esploraCompatible || !e.esploraOnly);
    const now = this.now();
    const healthy = eligible.filter(e => e.penalizedUntil <= now);
    const penalized = eligible.filter(e => e.penalizedUntil > now)
      .sort((a, b) => a.penalizedUntil - b.penalizedUntil);
    return [...healthy, ...penalized];
  }

  private async call<T>(
    esploraCompatible: boolean,
    fn: (p: ChainDataProvider) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (const endpoint of this.ranked(esploraCompatible)) {
      try {
        return await fn(endpoint.provider);
      } catch (err) {
        if (!isFailoverable(err)) throw err; // a real answer, or the caller left
        endpoint.penalizedUntil = this.now() + this.cooldownMs;
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // Esplora-compatible reads: every endpoint, bare Esplora included.

  getTransaction(txid: string, opts?: RequestOptions): Promise<NormalizedTransaction> {
    return this.call(true, p => p.getTransaction(txid, opts));
  }

  getAddressStats(address: string, opts?: RequestOptions): Promise<AddressStats> {
    return this.call(true, p => p.getAddressStats(address, opts));
  }

  getAddressTxs(address: string, afterTxid?: string, opts?: RequestOptions): Promise<NormalizedTransaction[]> {
    return this.call(true, p => p.getAddressTxs!(address, afterTxid, opts));
  }

  getAddressUtxos(address: string, opts?: RequestOptions): Promise<AddressUtxo[]> {
    return this.call(true, p => p.getAddressUtxos!(address, opts));
  }

  getOutspends(txid: string, opts?: RequestOptions): Promise<NormalizedOutspend[]> {
    return this.call(true, p => p.getOutspends!(txid, opts));
  }

  getBlockTxs(hash: string, startIndex: number, opts?: RequestOptions): Promise<NormalizedTransaction[]> {
    return this.call(true, p => p.getBlockTxs!(hash, startIndex, opts));
  }

  // mempool-/v1 reads: full mempool instances only.

  getRecentBlocks(beforeHeight?: number, opts?: RequestOptions): Promise<NormalizedBlock[]> {
    return this.call(false, p => p.getRecentBlocks!(beforeHeight, opts));
  }

  getMempoolBlocks(opts?: RequestOptions): Promise<ProjectedBlock[]> {
    return this.call(false, p => p.getMempoolBlocks!(opts));
  }

  getBlock(heightOrHash: string, opts?: RequestOptions): Promise<NormalizedBlock> {
    return this.call(false, p => p.getBlock!(heightOrHash, opts));
  }

  getBlockSummary(hash: string, opts?: RequestOptions): Promise<BlockTxSummary[]> {
    return this.call(false, p => p.getBlockSummary!(hash, opts));
  }

  getBlockAudit(hash: string, opts?: RequestOptions): Promise<BlockAudit | null> {
    return this.call(false, p => p.getBlockAudit!(hash, opts));
  }
}
