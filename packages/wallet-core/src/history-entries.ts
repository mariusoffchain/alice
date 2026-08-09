import type { PaymentRecord } from './payment-types';
import type { Transaction } from './wallet-backend';

export type HistoryEntry =
  | { kind: 'transaction'; id: string; createdAt: number; transaction: Transaction }
  | { kind: 'payment'; id: string; createdAt: number; payment: PaymentRecord };

const SWAP_MATCH_WINDOW_MS = 30 * 60_000;
const INACTIVE_PAYMENT_STATUSES = new Set(['failed', 'expired', 'refunded']);
const HOME_VISIBLE_TRANSACTION_STATUSES = new Set(['preconfirmed', 'settled']);
const HOME_VISIBLE_PAYMENT_STATUSES = new Set(['settled']);

function transactionIds(transaction: Transaction): string[] {
  return [transaction.id, transaction.arkTxid, transaction.commitmentTxid, transaction.boardingTxid].filter(Boolean);
}

function outgoingSwapAmount(payment: PaymentRecord): number {
  const data = (payment.providerData ?? {}) as { sendAmountSats?: number };
  return data.sendAmountSats ?? payment.amountSats + payment.feeSats;
}

function matchesOutgoingSwapFunding(transaction: Transaction, payment: PaymentRecord): boolean {
  if (transaction.type !== 'outgoing' || transaction.layer !== 'ark' || payment.direction !== 'outgoing') return false;
  if (INACTIVE_PAYMENT_STATUSES.has(payment.status)) return false;

  const data = (payment.providerData ?? {}) as { fundingTxid?: string };
  if (data.fundingTxid) return transactionIds(transaction).includes(data.fundingTxid);

  return transaction.amount === outgoingSwapAmount(payment)
    && Math.abs(transaction.createdAt - payment.createdAt) < 10 * 60_000;
}

function matchesIncomingSwapClaim(transaction: Transaction, payment: PaymentRecord): boolean {
  if (transaction.type !== 'incoming' || transaction.layer !== 'ark') return false;
  if (
    payment.direction !== 'incoming'
    || !['lightning', 'onchain'].includes(payment.layer)
  ) return false;
  if (INACTIVE_PAYMENT_STATUSES.has(payment.status)) return false;

  const data = (payment.providerData ?? {}) as { completionTxid?: string };
  if (data.completionTxid) {
    return transactionIds(transaction).includes(data.completionTxid);
  }

  // Older receive records do not expose the claim txid. Match them
  // conservatively by net amount and nearby creation time.
  return transaction.amount === payment.amountSats
    && Math.abs(transaction.createdAt - payment.createdAt) < SWAP_MATCH_WINDOW_MS;
}

function findClosestTransaction(
  transactions: Transaction[],
  hidden: Set<Transaction>,
  payment: PaymentRecord,
  matcher: (transaction: Transaction, payment: PaymentRecord) => boolean,
): Transaction | null {
  return transactions
    .filter(transaction => !hidden.has(transaction) && matcher(transaction, payment))
    .sort((a, b) => Math.abs(a.createdAt - payment.createdAt) - Math.abs(b.createdAt - payment.createdAt))[0] ?? null;
}

export function filterPaymentBackingTransactions(transactions: Transaction[], payments: PaymentRecord[]): Transaction[] {
  const hidden = new Set<Transaction>();

  for (const payment of payments) {
    const fundingTransaction = findClosestTransaction(transactions, hidden, payment, matchesOutgoingSwapFunding);
    if (fundingTransaction) hidden.add(fundingTransaction);
  }

  for (const payment of payments) {
    const claimTransaction = findClosestTransaction(
      transactions,
      hidden,
      payment,
      matchesIncomingSwapClaim,
    );
    if (claimTransaction) hidden.add(claimTransaction);
  }

  return transactions.filter(transaction => !hidden.has(transaction));
}

export function buildHistoryEntries(
  transactions: Transaction[],
  payments: PaymentRecord[],
  limit?: number,
): HistoryEntry[] {
  const entries = [
    ...filterPaymentBackingTransactions(transactions, payments).map(transaction => ({
      kind: 'transaction' as const,
      id: transaction.id,
      createdAt: transaction.createdAt,
      transaction,
    })),
    ...payments.map(payment => ({
      kind: 'payment' as const,
      id: payment.id,
      createdAt: payment.createdAt,
      payment,
    })),
  ].sort((a, b) => b.createdAt - a.createdAt);

  return typeof limit === 'number' ? entries.slice(0, limit) : entries;
}

function paymentHasNetworkEvidence(payment: PaymentRecord): boolean {
  const data = (payment.providerData ?? {}) as {
    fundingTxid?: string;
    completionTxid?: string;
    transactionId?: string;
    txid?: string;
  };
  return Boolean(payment.txid || data.fundingTxid || data.completionTxid || data.transactionId || data.txid);
}

export function isHomeRecentHistoryEntry(entry: HistoryEntry): boolean {
  if (entry.kind === 'transaction') return HOME_VISIBLE_TRANSACTION_STATUSES.has(entry.transaction.status);
  if (HOME_VISIBLE_PAYMENT_STATUSES.has(entry.payment.status)) return true;
  return entry.payment.status === 'pending' && paymentHasNetworkEvidence(entry.payment);
}

export function buildHomeRecentHistoryEntries(
  transactions: Transaction[],
  payments: PaymentRecord[],
  limit = 2,
): HistoryEntry[] {
  return buildHistoryEntries(transactions, payments)
    .filter(isHomeRecentHistoryEntry)
    .slice(0, limit);
}
