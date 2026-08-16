// Client for an Arkade ASP (arkd) public REST gateway.
//
// Arkade is an off-chain execution layer on Bitcoin: value lives in VTXOs held
// by an Ark Service Provider (ASP), and the ASP periodically settles a round of
// VTXOs on-chain in a "commitment" transaction. There is no block sequence of
// its own, and the ASP exposes no historical list of commitments (its /v1/txs
// is a live stream), so this Explorer view reads two things the gateway does
// serve: the ASP's parameters (/v1/info) and a single commitment round by its
// on-chain txid (/v1/indexer/commitmentTx/{txid}).
//
// The gateway is public and CORS-open (the official arkade.space explorer calls
// it cross-origin), so this runs straight from the browser, no proxy. Every
// numeric field crosses the gRPC-gateway as a string; we parse defensively.

/** Parse a gateway numeric string ("330", "60") to a number, 0 on garbage. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export class ArkadeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArkadeError';
  }
}

/** The ASP's advertised parameters, from /v1/info. */
export type ArkadeInfo = {
  version: string;
  /** Settlement network the commitments land on (e.g. "bitcoin"). */
  network: string;
  signerPubkey: string;
  forfeitAddress: string;
  /** Round/session length in seconds. */
  sessionDurationSec: number;
  dustSats: number;
  vtxoMinSats: number;
  vtxoMaxSats: number;
  /** Blocks a user must wait to exit unilaterally. */
  unilateralExitDelay: number;
  maxTxWeight: number;
};

/** One VTXO batch inside a commitment round. */
export type ArkadeBatch = {
  /** The batch's identifying outpoint/key from the gateway map. */
  key: string;
  expiresAt?: number;
  swept: boolean;
  totalOutputAmountSats: number;
  totalOutputVtxos: number;
};

/** A commitment (round) transaction: the on-chain settlement of a VTXO round. */
export type ArkadeCommitment = {
  txid: string;
  /** Round window, unix seconds. */
  startedAt?: number;
  endedAt?: number;
  totalInputAmountSats: number;
  totalInputVtxos: number;
  totalOutputAmountSats: number;
  totalOutputVtxos: number;
  batches: ArkadeBatch[];
};

async function getJson(base: string, path: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
      signal: signal ?? AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    // Let an abort propagate as-is so callers can drop it silently instead of
    // surfacing a spurious "unreachable" when a re-render cancelled the fetch.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ArkadeError('Could not reach the Arkade ASP.');
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // A gateway returns JSON; HTML here means we hit a web app, not the API.
    throw new ArkadeError('That URL did not answer with the ASP API.');
  }
  if (!res.ok) {
    const msg = typeof json === 'object' && json !== null && typeof (json as { message?: unknown }).message === 'string'
      ? (json as { message: string }).message
      : `ASP error ${res.status}`;
    throw new ArkadeError(msg);
  }
  return json;
}

export async function getArkadeInfo(base: string, opts: { signal?: AbortSignal } = {}): Promise<ArkadeInfo> {
  const j = await getJson(base, '/v1/info', opts.signal) as Record<string, unknown>;
  return {
    version: String(j.version ?? ''),
    network: String(j.network ?? ''),
    signerPubkey: String(j.signerPubkey ?? ''),
    forfeitAddress: String(j.forfeitAddress ?? ''),
    sessionDurationSec: num(j.sessionDuration),
    dustSats: num(j.dust),
    vtxoMinSats: num(j.vtxoMinAmount),
    vtxoMaxSats: num(j.vtxoMaxAmount),
    unilateralExitDelay: num(j.unilateralExitDelay),
    maxTxWeight: num(j.maxTxWeight),
  };
}

function parseBatches(raw: unknown): ArkadeBatch[] {
  if (typeof raw !== 'object' || raw === null) return [];
  // The gateway serialises batches as a map keyed by the batch outpoint.
  return Object.entries(raw as Record<string, unknown>).map(([key, v]) => {
    const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    return {
      key,
      expiresAt: b.expiresAt !== undefined ? num(b.expiresAt) : undefined,
      swept: b.swept === true,
      totalOutputAmountSats: num(b.totalOutputAmount),
      totalOutputVtxos: num(b.totalOutputVtxos),
    };
  });
}

export async function getArkadeCommitment(base: string, txid: string, opts: { signal?: AbortSignal } = {}): Promise<ArkadeCommitment> {
  const clean = txid.trim().toLowerCase();
  const j = await getJson(base, `/v1/indexer/commitmentTx/${encodeURIComponent(clean)}`, opts.signal) as Record<string, unknown>;
  return {
    txid: clean,
    startedAt: j.startedAt !== undefined ? num(j.startedAt) : undefined,
    endedAt: j.endedAt !== undefined ? num(j.endedAt) : undefined,
    totalInputAmountSats: num(j.totalInputAmount),
    totalInputVtxos: num(j.totalInputVtxos),
    totalOutputAmountSats: num(j.totalOutputAmount),
    totalOutputVtxos: num(j.totalOutputVtxos),
    batches: parseBatches(j.batches),
  };
}

/**
 * The commitment lookup as a question: the round when the txid is a
 * settlement, null when the indexer does not know it ("batch not found").
 * Network failures still throw, so "not a commitment" is never concluded
 * from an unreachable ASP.
 */
export async function getArkadeCommitmentIfAny(base: string, txid: string, opts: { signal?: AbortSignal } = {}): Promise<ArkadeCommitment | null> {
  try {
    return await getArkadeCommitment(base, txid, opts);
  } catch (err) {
    if (err instanceof ArkadeError && /not found/i.test(err.message)) return null;
    throw err;
  }
}

/** A Bitcoin txid, so the commitment lookup can validate before calling. */
export function looksLikeTxid(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s.trim());
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

/** One VTXO (off-chain coin) held under an Arkade address. */
export type ArkadeVtxo = {
  txid: string;
  vout: number;
  amountSats: number;
  isSpent: boolean;
  isSwept: boolean;
  isPreconfirmed: boolean;
  createdAt?: number;
  expiresAt?: number;
  /** The commitment round(s) that anchor this VTXO on-chain. */
  commitmentTxids: string[];
  /** The checkpoint transaction that spent this VTXO, when spent. */
  spentBy?: string;
  /** The Arkade transaction behind that spend, when spent. */
  arkTxid?: string;
};

/** An Arkade address and the off-chain coins (VTXOs) it holds. */
export type ArkadeAddressInfo = {
  address: string;
  /** The taproot scriptPubKey the VTXOs sit on, hex. */
  scriptHex: string;
  spendableSats: number;
  spendableCount: number;
  totalCount: number;
  vtxos: ArkadeVtxo[];
};

/** Cheap prefilter so the UI can route input without loading the SDK. */
export function looksLikeArkadeAddress(s: string): boolean {
  return /^(ark|tark)1[0-9a-z]+$/i.test(s.trim());
}

/**
 * One VTXO from either shape we can meet: the SDK's RestIndexerProvider maps
 * the gateway into its VirtualCoin model ({ txid, vout, value, virtualStatus,
 * createdAt: Date, batchExpiry in ms }), while the raw gateway JSON nests the
 * outpoint and keeps everything in strings and seconds ({ outpoint, amount,
 * isSpent, expiresAt }). Accepting both keeps the view correct whichever layer
 * answers. Exported for tests.
 */
export function normalizeVtxo(v: Record<string, unknown>): ArkadeVtxo {
  const op = (typeof v.outpoint === 'object' && v.outpoint !== null ? v.outpoint : v) as Record<string, unknown>;
  const vs = (typeof v.virtualStatus === 'object' && v.virtualStatus !== null ? v.virtualStatus : {}) as Record<string, unknown>;
  const state = typeof vs.state === 'string' ? vs.state : '';
  const createdAt = v.createdAt instanceof Date
    ? Math.floor(v.createdAt.getTime() / 1000)
    : v.createdAt !== undefined ? num(v.createdAt) : undefined;
  const expiresAt = vs.batchExpiry !== undefined
    ? Math.floor(num(vs.batchExpiry) / 1000)
    : v.expiresAt !== undefined ? num(v.expiresAt) : undefined;
  const commitments = Array.isArray(vs.commitmentTxIds) ? vs.commitmentTxIds
    : Array.isArray(v.commitmentTxids) ? v.commitmentTxids : [];
  // The spender fields differ by shape too: SDK `arkTxId`, gateway `arkTxid`.
  const spentBy = typeof v.spentBy === 'string' && v.spentBy ? v.spentBy : undefined;
  const arkTxid = typeof v.arkTxId === 'string' && v.arkTxId ? v.arkTxId
    : typeof v.arkTxid === 'string' && v.arkTxid ? v.arkTxid : undefined;
  return {
    txid: String(op.txid ?? ''),
    vout: num(op.vout),
    amountSats: v.amount !== undefined ? num(v.amount) : num(v.value),
    isSpent: v.isSpent === true || state === 'spent',
    isSwept: v.isSwept === true || state === 'swept',
    isPreconfirmed: v.isPreconfirmed === true || state === 'preconfirmed',
    createdAt,
    expiresAt,
    commitmentTxids: commitments.map(String),
    spentBy,
    arkTxid,
  };
}

/**
 * Resolve an Arkade address to its VTXOs and balance. Uses the official SDK
 * (loaded lazily) to decode the address into its taproot script, then queries
 * the ASP indexer for the VTXOs on that script. This is the "search an address"
 * of the Arkade explorer: it shows off-chain coins, not on-chain outputs.
 */
export async function getArkadeAddressVtxos(base: string, address: string, opts: { signal?: AbortSignal } = {}): Promise<ArkadeAddressInfo> {
  const { ArkAddress, RestIndexerProvider, isValidArkAddress } = await import('@arkade-os/sdk');
  const a = address.trim();
  if (!isValidArkAddress(a)) throw new ArkadeError('That is not a valid Arkade address.');
  let scriptHex: string;
  try {
    scriptHex = bytesToHex(ArkAddress.decode(a).pkScript);
  } catch {
    throw new ArkadeError('Could not decode that Arkade address.');
  }
  const indexer = new RestIndexerProvider(base.replace(/\/+$/, ''));
  let res: unknown;
  try {
    res = await indexer.getVtxos({ scripts: [scriptHex] });
  } catch (err) {
    if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    throw new ArkadeError(err instanceof Error ? err.message : 'Could not load VTXOs for this address.');
  }
  const raw = (res as { vtxos?: unknown })?.vtxos;
  const vtxos = (Array.isArray(raw) ? raw : []).map(v => normalizeVtxo(v as Record<string, unknown>));
  const spendable = vtxos.filter(v => !v.isSpent && !v.isSwept);
  return {
    address: a,
    scriptHex,
    vtxos,
    totalCount: vtxos.length,
    spendableCount: spendable.length,
    spendableSats: spendable.reduce((s, v) => s + v.amountSats, 0),
  };
}

/** One input of a virtual (off-chain) Arkade transaction. */
export type ArkadeVirtualTxInput = {
  txid: string;
  vout: number;
  amountSats?: number;
};

/** One output of a virtual Arkade transaction, enriched with its VTXO state
 *  when the indexer knows the outpoint. */
export type ArkadeVirtualTxOutput = {
  index: number;
  amountSats: number;
  scriptHex: string;
  /** The zero-value P2A anchor output every virtual transaction carries. */
  isAnchor: boolean;
  vtxo?: ArkadeVtxo;
};

/** A virtual Arkade transaction: off-chain, held by the ASP, not on Bitcoin. */
export type ArkadeVirtualTx = {
  txid: string;
  inputs: ArkadeVirtualTxInput[];
  outputs: ArkadeVirtualTxOutput[];
};

// The ephemeral anchor script (P2A), present on every virtual transaction.
const ANCHOR_SCRIPT_HEX = '51024e73';

/**
 * Look a virtual (off-chain) Arkade transaction up by txid: the indexer serves
 * its PSBT, decoded here for the inputs/outputs, and the outputs are enriched
 * with their VTXO state. Null when the indexer does not know the txid — which
 * is also the answer for any plain on-chain txid, so callers try Esplora first.
 */
export async function getArkadeVirtualTx(base: string, txid: string, opts: { signal?: AbortSignal } = {}): Promise<ArkadeVirtualTx | null> {
  const clean = txid.trim().toLowerCase();
  let j: unknown;
  try {
    j = await getJson(base, `/v1/indexer/virtualTx/${encodeURIComponent(clean)}`, opts.signal);
  } catch (err) {
    if (err instanceof ArkadeError && /not found/i.test(err.message)) return null;
    throw err;
  }
  const raw = (j as { txs?: unknown })?.txs;
  if (!Array.isArray(raw) || raw.length === 0 || typeof raw[0] !== 'string') return null;

  // The PSBT decoder is only needed here; loaded lazily like the SDK so it
  // stays out of the app's first load.
  const { Transaction } = await import('@scure/btc-signer');
  let tx: InstanceType<typeof Transaction>;
  try {
    const bytes = Uint8Array.from(atob(raw[0]), c => c.charCodeAt(0));
    tx = Transaction.fromPSBT(bytes, { allowUnknown: true, allowUnknownInputs: true, allowUnknownOutputs: true });
  } catch {
    throw new ArkadeError('Could not decode this virtual transaction.');
  }

  const inputs: ArkadeVirtualTxInput[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    inputs.push({
      txid: inp.txid ? bytesToHex(inp.txid) : '',
      vout: inp.index ?? 0,
      amountSats: inp.witnessUtxo ? Number(inp.witnessUtxo.amount) : undefined,
    });
  }
  const outputs: ArkadeVirtualTxOutput[] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i);
    const scriptHex = out.script ? bytesToHex(out.script) : '';
    outputs.push({
      index: i,
      amountSats: out.amount !== undefined ? Number(out.amount) : 0,
      scriptHex,
      isAnchor: scriptHex === ANCHOR_SCRIPT_HEX,
    });
  }

  // Enrich the non-anchor outputs with their VTXO state (spent, expiry, the
  // settlement anchoring them). Decorative: a miss leaves the plain outputs.
  try {
    const query = outputs.filter(o => !o.isAnchor)
      .map(o => `outpoints=${clean}:${o.index}`).join('&');
    if (query) {
      const res = await getJson(base, `/v1/indexer/vtxos?${query}`, opts.signal) as { vtxos?: unknown };
      for (const v of Array.isArray(res.vtxos) ? res.vtxos : []) {
        const vtxo = normalizeVtxo(v as Record<string, unknown>);
        const target = outputs.find(o => o.index === vtxo.vout);
        if (target) target.vtxo = vtxo;
      }
    }
  } catch { /* keep the decoded outputs */ }

  return { txid: clean, inputs, outputs };
}

/** A settlement (commitment round) seen on the live stream. */
export type ArkadeSettlement = {
  txid: string;
  /** New VTXOs created by the round. */
  spendableVtxos: number;
  /** VTXOs spent/forfeited into the round. */
  spentVtxos: number;
  /** Client clock when the event arrived (the stream carries no timestamp). */
  receivedAt: number;
};

/**
 * Subscribe to the ASP's live transaction stream and call `onSettlement` for
 * every commitment (settlement) round as it is finalized. Runs until the signal
 * aborts or the stream ends; the caller decides whether to reconnect.
 *
 * The endpoint is a server-side stream: per its own docs it has NO history, only
 * events from the moment it opens. Each event is a JSON object (SSE `data:` line
 * or a bare line); the commitment variant carries the round's txid and VTXOs.
 */
export async function subscribeSettlements(
  base: string,
  onSettlement: (s: ArkadeSettlement) => void,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  const res = await fetch(`${base.replace(/\/+$/, '')}/v1/txs`, {
    signal: opts.signal,
    headers: { Accept: 'text/event-stream' },
  });
  if (!res.ok || !res.body) throw new ArkadeError(`Stream error ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string) => {
    const text = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!text || text === ':' ) return;
    let obj: unknown;
    try { obj = JSON.parse(text); } catch { return; }
    // grpc-gateway wraps a stream message as { result: <msg> }.
    const msg = (typeof obj === 'object' && obj !== null && 'result' in obj
      ? (obj as { result: unknown }).result
      : obj) as Record<string, unknown> | null;
    const c = msg && typeof msg === 'object' ? (msg as Record<string, unknown>).commitmentTx : undefined;
    if (c && typeof c === 'object') {
      const n = c as Record<string, unknown>;
      if (typeof n.txid === 'string' && n.txid) {
        onSettlement({
          txid: n.txid,
          spendableVtxos: Array.isArray(n.spendableVtxos) ? n.spendableVtxos.length : 0,
          spentVtxos: Array.isArray(n.spentVtxos) ? n.spentVtxos.length : 0,
          receivedAt: Date.now(),
        });
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      handleLine(line);
    }
  }
}
