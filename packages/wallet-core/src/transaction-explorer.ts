import type { PaymentRecord } from './payment-types';
import type { Transaction } from './wallet-backend';
import { ARKADE_EXPLORER, MEMPOOL_EXPLORER } from './network-config.ts';

export type ExplorerLink = {
  url: string;
  direct: boolean;
  kind: 'arkade' | 'bitcoin';
};

function configuredArkadeExplorer(txid: string): ExplorerLink | null {
  if (ARKADE_EXPLORER) {
    return { url: `${ARKADE_EXPLORER}/tx/${txid}`, direct: true, kind: 'arkade' };
  }
  return null;
}

export function resolveTransactionExplorer(tx: Transaction): ExplorerLink | null {
  if (tx.arkTxid) return configuredArkadeExplorer(tx.arkTxid);
  if (tx.commitmentTxid) return { url: `${MEMPOOL_EXPLORER}/tx/${tx.commitmentTxid}`, direct: true, kind: 'bitcoin' };
  if (tx.boardingTxid) return { url: `${MEMPOOL_EXPLORER}/tx/${tx.boardingTxid}`, direct: true, kind: 'bitcoin' };
  return null;
}

export function resolvePaymentExplorer(payment: PaymentRecord): ExplorerLink | null {
  if (payment.txid) return { url: `${MEMPOOL_EXPLORER}/tx/${payment.txid}`, direct: true, kind: 'bitcoin' };
  const data = (payment.providerData ?? {}) as { arkadeFundingTxid?: string; fundingTxid?: string };
  if (data.arkadeFundingTxid) return configuredArkadeExplorer(data.arkadeFundingTxid);
  if (data.fundingTxid) return { url: `${MEMPOOL_EXPLORER}/tx/${data.fundingTxid}`, direct: true, kind: 'bitcoin' };
  return null;
}

export function resolveArkadeExplorer(txid: string): ExplorerLink | null {
  return configuredArkadeExplorer(txid);
}
