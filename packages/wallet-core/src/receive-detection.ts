import type { Transaction, VtxoInfo } from './wallet-backend';

export function findNewIncomingTransaction(
  history: Transaction[],
  initialIncomingIds: ReadonlySet<string>,
  receiveStartedAt = Number.POSITIVE_INFINITY,
): Transaction | null {
  return history
    .filter(transaction => transaction.type === 'incoming')
    .filter(transaction =>
      !initialIncomingIds.has(transaction.id)
      || transaction.createdAt >= receiveStartedAt
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export function findNewReceivedVtxo(
  vtxos: VtxoInfo[],
  initialVtxoIds: ReadonlySet<string>,
  receiveStartedAt = Number.POSITIVE_INFINITY,
): VtxoInfo | null {
  return vtxos
    .filter(vtxo => vtxo.state === 'preconfirmed' || vtxo.state === 'settled')
    .filter(vtxo =>
      !initialVtxoIds.has(vtxo.id)
      || vtxo.createdAt >= receiveStartedAt
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}
