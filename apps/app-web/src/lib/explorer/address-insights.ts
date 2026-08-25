// Pure privacy insights for an address, computed from data already fetched: the
// address's transactions and its unspent outputs. No network here.

import type { NormalizedTransaction } from './types.ts';

// One unspent output, enough to age it.
export type AddressUtxo = { valueSats: number; blockTime?: number };

/**
 * Addresses provably linked to this one by the common-input-ownership heuristic:
 * any address that was spent together with it in the same transaction is, by the
 * standard assumption, the same owner. Defeatable by coinjoin, so "probable",
 * not certain. Computed from the loaded transactions, no extra requests.
 */
export function linkedAddresses(txs: NormalizedTransaction[], address: string): string[] {
  const set = new Set<string>();
  for (const tx of txs) {
    const spendsHere = tx.inputs.some(i => i.address === address);
    if (!spendsHere) continue;
    for (const i of tx.inputs) if (i.address && i.address !== address) set.add(i.address);
  }
  return [...set];
}

export type UtxoAge = {
  /** Value-weighted mean age, in days. */
  days: number;
  /** How many confirmed UTXOs were aged. */
  count: number;
  totalValueSats: number;
};

/** Value-weighted average age of the address's confirmed unspent outputs. */
export function averageUtxoAge(utxos: AddressUtxo[], nowSec: number): UtxoAge | null {
  const confirmed = utxos.filter(u => typeof u.blockTime === 'number');
  if (confirmed.length === 0) return null;
  const totalValue = confirmed.reduce((s, u) => s + u.valueSats, 0) || 1;
  const weightedSec = confirmed.reduce((s, u) => s + u.valueSats * Math.max(0, nowSec - (u.blockTime as number)), 0) / totalValue;
  return { days: weightedSec / 86400, count: confirmed.length, totalValueSats: totalValue };
}
