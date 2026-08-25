// The frontend never depends on a single provider's JSON shape. Every backend
// (mempool.space, a self-hosted Esplora, a personal node later) resolves into
// this normalized model. All Bitcoin amounts are integer satoshis; BTC floats
// never appear in logic, only at the formatting edge.

export type DataSource = {
  /** Human label shown in the UI, e.g. "mempool.space". */
  name: string;
  /** Base API URL actually queried, so the UI can show where data came from. */
  baseUrl: string;
};

export type TxStatus = {
  confirmed: boolean;
  /** Present only when confirmed. */
  blockHeight?: number;
  /** Unix seconds, present only when confirmed. */
  blockTime?: number;
};

export type ScriptType =
  | 'p2pk' | 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr'
  | 'op_return' | 'multisig' | 'unknown';

export type NormalizedInput = {
  /** The outpoint being spent. */
  prevTxid: string;
  prevVout: number;
  /** Resolved from the previous output when the provider supplies it. */
  address?: string;
  valueSats?: number;
  scriptType?: ScriptType;
  sequence: number;
  isCoinbase: boolean;
  /** False when the amount is blinded and not public (a Liquid confidential
   *  input). Absent means the amount is known, as on Bitcoin. */
  amountKnown?: boolean;
};

export type NormalizedOutput = {
  /** Position in the output vector, the `vout`. */
  index: number;
  address?: string;
  /** 0 when the amount is not public (see amountKnown); a Bitcoin output is
   *  always known. */
  valueSats: number;
  scriptType?: ScriptType;
  /** False when the amount is blinded and not public (a Liquid confidential
   *  output). Absent means the amount is known, as on Bitcoin. */
  amountKnown?: boolean;
  /** True/false when known whether this output has since been spent; undefined
   *  when the provider was not asked. */
  spent?: boolean;
};

// The spend status of one output, from Esplora's /tx/:txid/outspends. Indexed
// by vout. When `spent`, the spending transaction lets the UI walk forward.
export type NormalizedOutspend = {
  spent: boolean;
  /** Present only when spent: the child transaction and its input index. */
  txid?: string;
  vin?: number;
};

export type NormalizedTransaction = {
  txid: string;
  version: number;
  locktime: number;
  sizeBytes: number;
  weight: number;
  /** Virtual size, ceil(weight / 4). */
  vsize: number;
  /** Null when the provider cannot compute it (e.g. missing prevout values). */
  feeSats: number | null;
  feeRateSatVb: number | null;
  status: TxStatus;
  inputs: NormalizedInput[];
  outputs: NormalizedOutput[];
  isCoinbase: boolean;
  /** Any input signals BIP125 replaceability (sequence < 0xfffffffe). */
  rbfSignaled: boolean;
  source: DataSource;
};

// A confirmed block, for the live ribbon and the block view. Fee fields come
// from mempool's enriched blocks endpoint and are absent on a bare Esplora.
export type NormalizedBlock = {
  id: string; // hash
  height: number;
  timestamp: number; // unix seconds
  txCount: number;
  size: number; // bytes
  weight: number;
  medianFee?: number; // sat/vB
  feeRange?: number[]; // sat/vB percentiles, low..high
  totalFees?: number; // sats
  poolName?: string;
};

// A projected, not-yet-mined block from the mempool, for the left of the ribbon.
export type ProjectedBlock = {
  txCount: number;
  medianFee: number; // sat/vB
  feeRange: number[];
  totalFees: number; // sats
  blockVSize: number;
};

// What the live-blocks ribbon should spotlight for the active tab: a confirmed
// block by height, or, for an unconfirmed transaction, the projected mempool
// block it is expected to land in (chosen by fee rate).
export type RibbonFocus =
  | { kind: 'height'; height: number }
  | { kind: 'pending'; feeRate: number | null };

// One transaction's lightweight summary within a block, from mempool's
// /block/:hash/summary. Enough to size and colour it in the treemap without
// fetching every full transaction.
export type BlockTxSummary = {
  txid: string;
  vsize: number; // virtual bytes, drives the square's area
  rate: number; // fee rate, sat/vB, drives the colour
  valueSats: number;
  feeSats: number;
};

// The block audit: what the mempool predicted the block would contain (the
// template) versus what was mined, plus how closely they matched.
export type BlockAudit = {
  template: BlockTxSummary[];
  matchRate: number; // percent
};
