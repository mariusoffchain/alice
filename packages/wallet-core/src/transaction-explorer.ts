import type { PaymentRecord } from './payment-types';
import type { Transaction } from './wallet-backend';
import { ALICE_APP_URL, NETWORK } from './network-config.ts';

export type ExplorerLink = {
  url: string;
  direct: boolean;
  kind: 'arkade' | 'bitcoin';
};

// Network ids as Alice Explorer names them. Arkade settles on Bitcoin mainnet,
// so an Arkade subject always opens on the 'arkade' view regardless of the
// wallet build; an on-chain subject follows the chain this build runs on.
const BITCOIN_NETWORK_ID = NETWORK === 'bitcoin' ? 'mainnet' : 'mutinynet';

function aliceExplorer(kind: ExplorerLink['kind'], txid: string): ExplorerLink {
  const networkId = kind === 'arkade' ? 'arkade' : BITCOIN_NETWORK_ID;
  return {
    url: `${ALICE_APP_URL}/explorer?tx=${encodeURIComponent(txid)}&network=${networkId}`,
    direct: true,
    kind,
  };
}

export function resolveBitcoinExplorer(txid: string): ExplorerLink {
  return aliceExplorer('bitcoin', txid);
}

export function resolveArkadeExplorer(txid: string): ExplorerLink {
  return aliceExplorer('arkade', txid);
}

export function resolveTransactionExplorer(tx: Transaction): ExplorerLink | null {
  if (tx.arkTxid) return resolveArkadeExplorer(tx.arkTxid);
  if (tx.commitmentTxid) return resolveBitcoinExplorer(tx.commitmentTxid);
  if (tx.boardingTxid) return resolveBitcoinExplorer(tx.boardingTxid);
  return null;
}

export function resolvePaymentExplorer(payment: PaymentRecord): ExplorerLink | null {
  // A Lightning or Arkade payment records its Arkade claim/funding txid; only
  // an on-chain payment's txid is a Bitcoin transaction.
  if (payment.txid) {
    return payment.layer === 'onchain'
      ? resolveBitcoinExplorer(payment.txid)
      : resolveArkadeExplorer(payment.txid);
  }
  const data = (payment.providerData ?? {}) as { arkadeFundingTxid?: string; fundingTxid?: string };
  if (data.arkadeFundingTxid) return resolveArkadeExplorer(data.arkadeFundingTxid);
  if (data.fundingTxid) return resolveBitcoinExplorer(data.fundingTxid);
  return null;
}
