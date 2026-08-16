// mempool.space (and any Esplora-compatible endpoint) provider. The pure mapping
// `normalizeMempoolTx` is kept apart from the network call so it can be unit
// tested against fixtures with no fetch.

import type {
  ChainDataProvider,
} from './provider.ts';
import type {
  BlockAudit,
  BlockTxSummary,
  DataSource,
  NormalizedBlock,
  NormalizedInput,
  NormalizedOutput,
  NormalizedOutspend,
  NormalizedTransaction,
  ProjectedBlock,
  ScriptType,
} from './types.ts';
import { ChainDataError } from './provider.ts';
import type { RequestOptions } from './provider.ts';
import type { AddressStats } from './signals.ts';
import type { AddressUtxo } from './address-insights.ts';

// The subset of the Esplora tx schema this maps. Fields not listed are ignored.
type EsploraPrevout = {
  scriptpubkey_address?: string;
  scriptpubkey_type?: string;
  value?: number;
};
type EsploraVin = {
  txid: string;
  vout: number;
  prevout: EsploraPrevout | null;
  sequence: number;
  is_coinbase: boolean;
};
type EsploraVout = {
  scriptpubkey_address?: string;
  scriptpubkey_type?: string;
  /** Absent for a Liquid confidential output (blinded amount). */
  value?: number;
};
type EsploraStatus = {
  confirmed: boolean;
  block_height?: number;
  block_time?: number;
};
export type EsploraTx = {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee?: number;
  vin: EsploraVin[];
  vout: EsploraVout[];
  status: EsploraStatus;
};

// Esplora names non-standard scripts "v0_p2wpkh", "v1_p2tr", "op_return" etc.
// Normalize to the compact set used across the engine.
function mapScriptType(raw: string | undefined): ScriptType | undefined {
  if (!raw) return undefined;
  switch (raw) {
    case 'p2pk': return 'p2pk';
    case 'p2pkh': return 'p2pkh';
    case 'p2sh': return 'p2sh';
    case 'v0_p2wpkh': return 'p2wpkh';
    case 'v0_p2wsh': return 'p2wsh';
    case 'v1_p2tr': return 'p2tr';
    case 'op_return': return 'op_return';
    case 'multisig': return 'multisig';
    default: return 'unknown';
  }
}

const SEQUENCE_RBF_CEILING = 0xfffffffe;

/** Pure mapping from an Esplora transaction to the normalized model. */
export function normalizeMempoolTx(tx: EsploraTx, source: DataSource): NormalizedTransaction {
  const isCoinbase = tx.vin.some(v => v.is_coinbase);

  // On Liquid a confidential input's amount is blinded (no plain `value`); mark
  // it not-known rather than guess. A coinbase input has no prevout at all.
  const inputs: NormalizedInput[] = tx.vin.map(v => ({
    prevTxid: v.txid,
    prevVout: v.vout,
    address: v.prevout?.scriptpubkey_address,
    valueSats: v.prevout?.value,
    scriptType: mapScriptType(v.prevout?.scriptpubkey_type),
    sequence: v.sequence,
    isCoinbase: v.is_coinbase,
    // Only a real (non-coinbase) input with a blinded prevout is "unknown".
    amountKnown: v.is_coinbase || v.prevout == null ? undefined : typeof v.prevout.value === 'number',
  }));

  // Liquid marks the explicit fee output with scriptpubkey_type "fee" and a
  // visible amount; it is the transaction fee, not a spendable output, so pull
  // it out (otherwise it double-counts, once as an output and once as the fee).
  const liquidFeeSats = tx.vout
    .filter(o => o.scriptpubkey_type === 'fee')
    .reduce((s, o) => s + (typeof o.value === 'number' ? o.value : 0), 0);

  // On Liquid a confidential output carries a blinded `valuecommitment` and no
  // plain `value`; the amount is not public. Keep valueSats at 0 for downstream
  // sums but flag it not-known so the UI shows "unknown", never a bogus 0.
  // Keep the original vout index (outspends are indexed by it) while dropping the
  // fee output from the spendable set.
  const outputs: NormalizedOutput[] = tx.vout
    .map((o, index) => ({
      index,
      address: o.scriptpubkey_address,
      valueSats: typeof o.value === 'number' ? o.value : 0,
      scriptType: mapScriptType(o.scriptpubkey_type),
      amountKnown: typeof o.value === 'number' ? undefined : false,
      isFee: o.scriptpubkey_type === 'fee',
    }))
    .filter(o => !o.isFee)
    .map(({ isFee: _isFee, ...o }) => o);

  const vsize = Math.ceil(tx.weight / 4);

  // A coinbase has no real fee. Otherwise: the explicit Liquid fee output wins;
  // then the provider's `fee` field; then sum(inputs) - sum(outputs), only when
  // every input value is known (never the case for a confidential Liquid tx).
  let feeSats: number | null = null;
  if (!isCoinbase) {
    if (liquidFeeSats > 0) {
      feeSats = liquidFeeSats;
    } else if (typeof tx.fee === 'number') {
      feeSats = tx.fee;
    } else if (inputs.every(i => typeof i.valueSats === 'number')) {
      const inSum = inputs.reduce((s, i) => s + (i.valueSats ?? 0), 0);
      const outSum = outputs.reduce((s, o) => s + o.valueSats, 0);
      feeSats = Math.max(0, inSum - outSum);
    }
  }

  const feeRateSatVb = feeSats !== null && vsize > 0
    ? Math.round((feeSats / vsize) * 100) / 100
    : null;

  const rbfSignaled = !isCoinbase && tx.vin.some(v => v.sequence < SEQUENCE_RBF_CEILING);

  return {
    txid: tx.txid,
    version: tx.version,
    locktime: tx.locktime,
    sizeBytes: tx.size,
    weight: tx.weight,
    vsize,
    feeSats,
    feeRateSatVb,
    status: {
      confirmed: tx.status.confirmed,
      blockHeight: tx.status.block_height,
      blockTime: tx.status.block_time,
    },
    inputs,
    outputs,
    isCoinbase,
    rbfSignaled,
    source,
  };
}

const TXID_RE = /^[0-9a-fA-F]{64}$/;

// mempool.space throttles aggressively; a throttled request can hang instead
// of failing. Cap every call so the UI gets a clear error, never an endless
// loading state. Callers can shorten this per request (bulk scans do).
const FETCH_TIMEOUT_MS = 15_000;

// The timeout and the caller's own cancellation ride the same fetch signal.
function requestSignal(opts?: RequestOptions): AbortSignal {
  const timeout = AbortSignal.timeout(opts?.timeoutMs ?? FETCH_TIMEOUT_MS);
  return opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
}

// A failed fetch is a cancellation when the caller's signal fired; anything
// else (timeout included) is a transient network error, worth retrying.
function fetchFailure(opts: RequestOptions | undefined, name: string): ChainDataError {
  if (opts?.signal?.aborted) return new ChainDataError('aborted', 'The request was cancelled.');
  return new ChainDataError('network', `Could not reach ${name}. Check the connection or the endpoint.`);
}

export class MempoolProvider implements ChainDataProvider {
  readonly source: DataSource;

  constructor(baseUrl = 'https://mempool.space/api', name = 'mempool.space') {
    // Trim a trailing slash so path joins are predictable.
    this.source = { name, baseUrl: baseUrl.replace(/\/$/, '') };
  }

  async getTransaction(txid: string, opts?: RequestOptions): Promise<NormalizedTransaction> {
    const clean = txid.trim().toLowerCase();
    if (!TXID_RE.test(clean)) {
      throw new ChainDataError('invalid-input', 'Not a valid transaction id.');
    }

    let res: Response;
    try {
      res = await fetch(`${this.source.baseUrl}/tx/${clean}`, {
        headers: { accept: 'application/json' },
        signal: requestSignal(opts),
      });
    } catch {
      throw fetchFailure(opts, this.source.name);
    }

    if (res.status === 404) {
      throw new ChainDataError('not-found', 'No transaction with that id was found.');
    }
    if (!res.ok) {
      throw new ChainDataError('backend', `${this.source.name} returned an error (${res.status}).`);
    }

    let json: EsploraTx;
    try {
      json = (await res.json()) as EsploraTx;
    } catch {
      throw new ChainDataError('backend', `${this.source.name} returned an unreadable response.`);
    }

    return normalizeMempoolTx(json, this.source);
  }

  async getOutspends(txid: string, opts?: RequestOptions): Promise<NormalizedOutspend[]> {
    const clean = txid.trim().toLowerCase();
    if (!TXID_RE.test(clean)) {
      throw new ChainDataError('invalid-input', 'Not a valid transaction id.');
    }

    let res: Response;
    try {
      res = await fetch(`${this.source.baseUrl}/tx/${clean}/outspends`, {
        headers: { accept: 'application/json' },
        signal: requestSignal(opts),
      });
    } catch {
      throw fetchFailure(opts, this.source.name);
    }
    if (res.status === 404) {
      throw new ChainDataError('not-found', 'No transaction with that id was found.');
    }
    if (!res.ok) {
      throw new ChainDataError('backend', `${this.source.name} returned an error (${res.status}).`);
    }

    type EsploraOutspend = { spent: boolean; txid?: string; vin?: number };
    let json: EsploraOutspend[];
    try {
      json = (await res.json()) as EsploraOutspend[];
    } catch {
      throw new ChainDataError('backend', `${this.source.name} returned an unreadable response.`);
    }

    return json.map(o => ({ spent: o.spent, txid: o.txid, vin: o.vin }));
  }

  async getAddressStats(address: string, opts?: RequestOptions): Promise<AddressStats> {
    const clean = address.trim();
    let res: Response;
    try {
      res = await fetch(`${this.source.baseUrl}/address/${encodeURIComponent(clean)}`, {
        headers: { accept: 'application/json' },
        signal: requestSignal(opts),
      });
    } catch {
      throw fetchFailure(opts, this.source.name);
    }
    if (res.status === 404) {
      throw new ChainDataError('not-found', 'No such address was found.');
    }
    if (!res.ok) {
      throw new ChainDataError('backend', `${this.source.name} returned an error (${res.status}).`);
    }

    type EsploraAddress = {
      chain_stats: {
        funded_txo_count: number; spent_txo_count: number; tx_count: number;
        funded_txo_sum: number; spent_txo_sum: number;
      };
    };
    let json: EsploraAddress;
    try {
      json = (await res.json()) as EsploraAddress;
    } catch {
      throw new ChainDataError('backend', `${this.source.name} returned an unreadable response.`);
    }

    return {
      address: clean,
      fundedCount: json.chain_stats.funded_txo_count,
      spentCount: json.chain_stats.spent_txo_count,
      txCount: json.chain_stats.tx_count,
      fundedSum: json.chain_stats.funded_txo_sum,
      spentSum: json.chain_stats.spent_txo_sum,
    };
  }

  async getAddressTxs(address: string, afterTxid?: string, opts?: RequestOptions): Promise<NormalizedTransaction[]> {
    // The first page is the newest 50; `chain/:txid` pages backward 25 at a time.
    const clean = encodeURIComponent(address.trim());
    const path = afterTxid ? `/address/${clean}/txs/chain/${afterTxid}` : `/address/${clean}/txs`;
    const json = await this.fetchJson<EsploraTx[]>(path, opts);
    return json.map(tx => normalizeMempoolTx(tx, this.source));
  }

  async getAddressUtxos(address: string, opts?: RequestOptions): Promise<AddressUtxo[]> {
    type EsploraUtxo = { value: number; status: { confirmed: boolean; block_time?: number } };
    const json = await this.fetchJson<EsploraUtxo[]>(`/address/${encodeURIComponent(address.trim())}/utxo`, opts);
    return json.map(u => ({ valueSats: u.value, blockTime: u.status.confirmed ? u.status.block_time : undefined }));
  }

  // Small JSON GET helper for the block endpoints, same timeout and typed errors
  // as the hand-rolled fetches above.
  private async fetchJson<T>(path: string, opts?: RequestOptions): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.source.baseUrl}${path}`, {
        headers: { accept: 'application/json' },
        signal: requestSignal(opts),
      });
    } catch {
      throw fetchFailure(opts, this.source.name);
    }
    if (res.status === 404) throw new ChainDataError('not-found', 'Not found.');
    if (!res.ok) throw new ChainDataError('backend', `${this.source.name} returned an error (${res.status}).`);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ChainDataError('backend', `${this.source.name} returned an unreadable response.`);
    }
  }

  async getRecentBlocks(beforeHeight?: number, opts?: RequestOptions): Promise<NormalizedBlock[]> {
    // mempool's enriched blocks carry fee extras a bare Esplora would not.
    // `/v1/blocks/:height` returns the batch ending at that height (paging back).
    const path = beforeHeight === undefined ? '/v1/blocks' : `/v1/blocks/${beforeHeight}`;
    const json = await this.fetchJson<EsploraBlock[]>(path, opts);
    return json.map(normalizeBlock);
  }

  async getMempoolBlocks(opts?: RequestOptions): Promise<ProjectedBlock[]> {
    const json = await this.fetchJson<MempoolBlockJson[]>('/v1/fees/mempool-blocks', opts);
    return json.map(b => ({
      txCount: b.nTx,
      medianFee: b.medianFee,
      feeRange: b.feeRange ?? [],
      totalFees: b.totalFees,
      blockVSize: b.blockVSize,
    }));
  }

  async getBlock(heightOrHash: string, opts?: RequestOptions): Promise<NormalizedBlock> {
    const clean = heightOrHash.trim();
    let hash = clean;
    // A pure-digit value is a height: resolve it to a hash first (Esplora).
    // Wrapped like every other call: a throttled or unreachable endpoint must
    // surface as a typed, retryable error, never a raw fetch failure (which
    // would read as stable and leave the block tab stuck on an error).
    if (/^\d+$/.test(clean)) {
      let res: Response;
      try {
        res = await fetch(`${this.source.baseUrl}/block-height/${clean}`, {
          headers: { accept: 'text/plain' },
          signal: requestSignal(opts),
        });
      } catch {
        throw fetchFailure(opts, this.source.name);
      }
      if (res.status === 404) throw new ChainDataError('not-found', 'No block at that height.');
      if (!res.ok) throw new ChainDataError('backend', `${this.source.name} returned an error (${res.status}).`);
      hash = (await res.text()).trim();
    }
    const json = await this.fetchJson<EsploraBlock>(`/v1/block/${hash}`, opts);
    return normalizeBlock(json);
  }

  async getBlockTxs(hash: string, startIndex: number, opts?: RequestOptions): Promise<NormalizedTransaction[]> {
    // Esplora returns up to 25 full transactions per page from the start index.
    const json = await this.fetchJson<EsploraTx[]>(`/block/${hash}/txs/${startIndex}`, opts);
    return json.map(tx => normalizeMempoolTx(tx, this.source));
  }

  async getBlockSummary(hash: string, opts?: RequestOptions): Promise<BlockTxSummary[]> {
    // Every transaction of the block in one call: txid, vsize, fee rate, value.
    const json = await this.fetchJson<SummaryTxJson[]>(`/v1/block/${hash}/summary`, opts);
    return json.map(mapSummaryTx);
  }

  async getBlockAudit(hash: string, opts?: RequestOptions): Promise<BlockAudit | null> {
    // Not every block is audited; a 404 means "no expected block", not an error.
    let res: Response;
    try {
      res = await fetch(`${this.source.baseUrl}/v1/block/${hash}/audit-summary`, {
        headers: { accept: 'application/json' },
        signal: requestSignal(opts),
      });
    } catch {
      throw fetchFailure(opts, this.source.name);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new ChainDataError('backend', `${this.source.name} returned an error (${res.status}).`);
    let json: { template?: SummaryTxJson[]; matchRate?: number };
    try {
      json = await res.json();
    } catch {
      throw new ChainDataError('backend', `${this.source.name} returned an unreadable response.`);
    }
    if (!json.template) return null;
    return { template: json.template.map(mapSummaryTx), matchRate: json.matchRate ?? 0 };
  }
}

type SummaryTxJson = { txid: string; vsize: number; rate: number; value: number; fee: number };

function mapSummaryTx(t: SummaryTxJson): BlockTxSummary {
  return { txid: t.txid, vsize: t.vsize, rate: t.rate, valueSats: t.value, feeSats: t.fee };
}

type EsploraBlock = {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  extras?: {
    medianFee?: number;
    feeRange?: number[];
    totalFees?: number;
    pool?: { name?: string };
  };
};

type MempoolBlockJson = {
  blockVSize: number;
  nTx: number;
  totalFees: number;
  medianFee: number;
  feeRange?: number[];
};

/** Pure mapping from an enriched block to the normalized model. */
export function normalizeBlock(b: EsploraBlock): NormalizedBlock {
  return {
    id: b.id,
    height: b.height,
    timestamp: b.timestamp,
    txCount: b.tx_count,
    size: b.size,
    weight: b.weight,
    medianFee: b.extras?.medianFee,
    feeRange: b.extras?.feeRange,
    totalFees: b.extras?.totalFees,
    poolName: b.extras?.pool?.name,
  };
}
