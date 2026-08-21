/**
 * Minimal Esplora client for the Mutinynet practice wallet.
 *
 * Talks to the public Mutinynet explorer API. Deliberately independent from
 * the Arkade/Boltz stack: the practice wallet is on-chain only.
 */
export const PRACTICE_ESPLORA_URL = 'https://mutinynet.com/api';
export const PRACTICE_EXPLORER_URL = 'https://mutinynet.com';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export type PracticeUtxoSummary = {
  txid: string;
  vout: number;
  valueSats: number;
  confirmed: boolean;
};

type EsploraVout = {
  scriptpubkey_address?: string;
  value: number;
};

type EsploraVin = {
  prevout?: EsploraVout | null;
};

export type EsploraAddressTx = {
  txid: string;
  fee: number;
  status: { confirmed: boolean; block_time?: number };
  vin: EsploraVin[];
  vout: EsploraVout[];
};

export type PracticeHistoryEntry = {
  txid: string;
  direction: 'incoming' | 'outgoing';
  /**
   * Net effect on the practice wallet in sats, always positive. For outgoing
   * transactions this includes the mining fee, matching what the user's
   * balance actually lost.
   */
  amountSats: number;
  feeSats: number;
  confirmed: boolean;
  blockTime: number | null;
};

export class PracticeEsploraClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string = PRACTICE_ESPLORA_URL, fetchImpl: FetchLike = defaultFetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const { fetchImpl } = this;
    const response = await fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(
        `Mutinynet explorer request failed (${response.status}) for ${path}.` +
          (detail ? ` ${detail}` : ''),
      );
    }
    return response;
  }

  async getTipHeight(): Promise<number> {
    const response = await this.request('/blocks/tip/height');
    const height = Number((await response.text()).trim());
    if (!Number.isInteger(height) || height < 0) {
      throw new Error('Mutinynet explorer returned an invalid tip height.');
    }
    return height;
  }

  async getAddressUtxos(address: string): Promise<PracticeUtxoSummary[]> {
    const response = await this.request(`/address/${address}/utxo`);
    const utxos = (await response.json()) as Array<{
      txid: string;
      vout: number;
      value: number;
      status: { confirmed: boolean };
    }>;
    return utxos.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      valueSats: utxo.value,
      confirmed: utxo.status.confirmed,
    }));
  }

  async getAddressTxs(address: string): Promise<EsploraAddressTx[]> {
    const response = await this.request(`/address/${address}/txs`);
    return (await response.json()) as EsploraAddressTx[];
  }

  async getFeeEstimates(): Promise<Record<string, number>> {
    const response = await this.request('/fee-estimates');
    return (await response.json()) as Record<string, number>;
  }

  /**
   * Recommended fee rate in sat/vB for the given confirmation target,
   * falling back to the closest available estimate, floored at 1 sat/vB.
   */
  async recommendedFeeRate(targetBlocks = 2): Promise<number> {
    const estimates = await this.getFeeEstimates();
    const rate =
      estimates[String(targetBlocks)] ??
      estimates['3'] ??
      estimates['6'] ??
      estimates['1'];
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
    return Math.max(1, Math.ceil(rate));
  }

  /** Broadcasts a raw transaction, returning its txid. */
  async broadcastTx(txHex: string): Promise<string> {
    const response = await this.request('/tx', { method: 'POST', body: txHex });
    const txid = (await response.text()).trim();
    if (!/^[0-9a-f]{64}$/i.test(txid)) {
      throw new Error(`Mutinynet explorer returned an invalid txid: ${txid.slice(0, 80)}`);
    }
    return txid;
  }
}

/**
 * Collapses raw Esplora transactions into wallet history entries, from the
 * point of view of the given set of practice wallet addresses.
 */
export function summarizePracticeHistory(
  txs: EsploraAddressTx[],
  ownedAddresses: ReadonlySet<string>,
): PracticeHistoryEntry[] {
  const entries: PracticeHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const tx of txs) {
    if (seen.has(tx.txid)) continue;
    seen.add(tx.txid);
    let ownedIn = 0;
    let ownedOut = 0;
    for (const vin of tx.vin) {
      const prevout = vin.prevout;
      if (prevout?.scriptpubkey_address && ownedAddresses.has(prevout.scriptpubkey_address)) {
        ownedIn += prevout.value;
      }
    }
    for (const vout of tx.vout) {
      if (vout.scriptpubkey_address && ownedAddresses.has(vout.scriptpubkey_address)) {
        ownedOut += vout.value;
      }
    }
    const net = ownedOut - ownedIn;
    if (net === 0) continue;
    entries.push({
      txid: tx.txid,
      direction: net > 0 ? 'incoming' : 'outgoing',
      amountSats: Math.abs(net),
      feeSats: tx.fee,
      confirmed: tx.status.confirmed,
      blockTime: tx.status.block_time ?? null,
    });
  }
  return entries;
}
