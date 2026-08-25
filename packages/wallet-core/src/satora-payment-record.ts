import type { PaymentRecord, PaymentStatus } from './payment-types.ts';
import type { SatoraStoredSwap } from './satora-storage.ts';

export type SatoraSwapSnapshot = {
  id?: unknown;
  direction?: unknown;
  status?: unknown;
  source_amount?: unknown;
  target_amount?: unknown;
  fee_sats?: unknown;
  created_at?: unknown;
  arkade_fund_txid?: unknown;
  arkade_claim_txid?: unknown;
  btc_fund_txid?: unknown;
  btc_claim_txid?: unknown;
  btc_htlc_address?: unknown;
  btc_refund_locktime?: unknown;
  arkade_vhtlc_address?: unknown;
  bolt11_invoice?: unknown;
  client_lightning_invoice?: unknown;
  target_arkade_address?: unknown;
  vhtlc_refund_locktime?: unknown;
  alice_claim_txid?: unknown;
  alice_refund_txid?: unknown;
  alice_invoice_expires_at?: unknown;
  alice_funding_attempted?: unknown;
};

const REFUNDED_STATUSES = new Set([
  'clientrefunded',
  'clientrefundedserverfunded',
  'clientrefundedserverrefunded',
  'clientredeemedandclientrefunded',
]);

const REFUNDABLE_STATUSES = new Set([
  'serverwontfund',
  'clientinvalidfunded',
  'clientfundedtoolate',
  'clientfundedserverrefunded',
  'expired',
]);

const FAILED_STATUSES = new Set([
  'serverwontfund',
  'clientinvalidfunded',
  'clientfundedtoolate',
  'expired',
]);

// The statuses the Satora protocol defines. Anything else the server sends
// is shown as "unknown": a status is displayed to the user as is.
const KNOWN_SATORA_STATUSES = new Set([
  'pending', 'clientfundingseen', 'clientfunded', 'serverfunded', 'clientredeeming',
  'clientredeemed', 'serverredeemed', 'expired', 'clientrefunded',
  'clientrefundedserverrefunded', 'clientrefundedserverfunded',
  'clientredeemedandclientrefunded', 'clientfundedserverrefunded', 'serverwontfund',
  'clientfundedtoolate', 'clientinvalidfunded', 'spent_refund', 'invalid',
]);

export function displaySatoraStatus(providerStatus: string): string {
  return KNOWN_SATORA_STATUSES.has(providerStatus) ? providerStatus : 'unknown';
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function wholeSats(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim()
    ? Number(value)
    : value;
  return Number.isSafeInteger(parsed) && Number(parsed) >= 0
    ? Number(parsed)
    : null;
}

export function hasSatoraFundingEvidence(snapshot: SatoraSwapSnapshot): boolean {
  const status = text(snapshot.status) ?? 'pending';
  return Boolean(
    text(snapshot.arkade_fund_txid)
    || text(snapshot.btc_fund_txid)
    || snapshot.alice_funding_attempted === true
    || !['pending', 'expired'].includes(status),
  );
}

export function mapSatoraPaymentStatus(
  providerStatus: unknown,
  funded: boolean,
): PaymentStatus {
  const status = text(providerStatus) ?? 'pending';
  if (status === 'serverredeemed') return 'settled';
  if (REFUNDED_STATUSES.has(status)) return 'refunded';
  if (REFUNDABLE_STATUSES.has(status) && funded) return 'refundable';
  if (FAILED_STATUSES.has(status)) return 'failed';
  return 'pending';
}

export function toSatoraPaymentRecord(
  stored: SatoraStoredSwap,
): PaymentRecord | null {
  const snapshot = stored.response as unknown as SatoraSwapSnapshot;
  if (
    snapshot.direction !== 'arkade_to_lightning'
    && snapshot.direction !== 'lightning_to_arkade'
    && snapshot.direction !== 'btc_to_arkade'
  ) return null;

  const id = text(snapshot.id) ?? stored.swapId;
  const receiveAmountSats = wholeSats(snapshot.target_amount);
  const sendAmountSats = wholeSats(snapshot.source_amount);
  if (receiveAmountSats === null || sendAmountSats === null) return null;

  if (
    snapshot.direction === 'lightning_to_arkade'
    || snapshot.direction === 'btc_to_arkade'
  ) {
    const isOnchain = snapshot.direction === 'btc_to_arkade';
    const providerStatus = text(snapshot.status) ?? 'pending';
    const fundingTxid = isOnchain
      ? text(snapshot.btc_fund_txid)
      : text(snapshot.arkade_fund_txid);
    const arkadeFundingTxid = text(snapshot.arkade_fund_txid);
    const claimTxid = text(snapshot.arkade_claim_txid)
      ?? text(snapshot.alice_claim_txid);
    const refundTxid = text(snapshot.alice_refund_txid);
    const hasNetworkEvidence = Boolean(
      fundingTxid
      || arkadeFundingTxid
      || claimTxid
      || !['pending', 'expired'].includes(providerStatus),
    );
    if (!hasNetworkEvidence) return null;

    const providerPaymentStatus = mapSatoraPaymentStatus(
      providerStatus,
      Boolean(fundingTxid),
    );
    const onchainStatus = providerPaymentStatus === 'settled'
      ? 'pending'
      : providerPaymentStatus;
    const status: PaymentStatus = claimTxid
      ? 'settled'
      : refundTxid && providerPaymentStatus !== 'refunded'
        ? 'pending'
        : isOnchain
          ? onchainStatus
          : providerStatus === 'expired'
            ? 'expired'
            : FAILED_STATUSES.has(providerStatus)
              ? 'failed'
              : 'pending';
    const createdAt = text(snapshot.created_at)
      ? Date.parse(text(snapshot.created_at)!)
      : stored.storedAt;
    const invoiceExpiresAt = wholeSats(snapshot.alice_invoice_expires_at);
    const refundLocktime = wholeSats(snapshot.btc_refund_locktime);

    return {
      id,
      provider: 'satora',
      layer: isOnchain ? 'onchain' : 'lightning',
      direction: 'incoming',
      amountSats: receiveAmountSats,
      feeSats: Math.max(0, sendAmountSats - receiveAmountSats),
      status,
      createdAt: Number.isFinite(createdAt) ? createdAt : stored.storedAt,
      expiresAt: isOnchain
        ? refundLocktime === null ? null : refundLocktime * 1_000
        : invoiceExpiresAt,
      txid: isOnchain ? fundingTxid : claimTxid,
      swapId: id,
      refundable: isOnchain && status === 'refundable' && !refundTxid,
      providerData: {
        destination: text(snapshot.target_arkade_address),
        invoice: isOnchain ? undefined : text(snapshot.bolt11_invoice),
        fundingAddress: isOnchain
          ? text(snapshot.btc_htlc_address)
          : text(snapshot.arkade_vhtlc_address),
        fundingTxid,
        arkadeFundingTxid,
        completionTxid: claimTxid,
        refundTxid,
        providerStatus: displaySatoraStatus(providerStatus),
        sendAmountSats,
      },
    };
  }

  const funded = hasSatoraFundingEvidence(snapshot);
  if (!funded) return null;

  const fundingTxid = text(snapshot.arkade_fund_txid);
  const refundTxid = text(snapshot.alice_refund_txid);
  const providerStatus = text(snapshot.status) ?? 'pending';
  const providerPaymentStatus = mapSatoraPaymentStatus(providerStatus, funded);
  const status = refundTxid && providerPaymentStatus !== 'refunded'
    ? 'pending'
    : providerPaymentStatus;
  const createdAt = text(snapshot.created_at)
    ? Date.parse(text(snapshot.created_at)!)
    : stored.storedAt;
  const refundLocktime = wholeSats(snapshot.vhtlc_refund_locktime);

  return {
    id,
    provider: 'satora',
    layer: 'lightning',
    direction: 'outgoing',
    amountSats: receiveAmountSats,
    feeSats: Math.max(0, sendAmountSats - receiveAmountSats),
    status,
    createdAt: Number.isFinite(createdAt) ? createdAt : stored.storedAt,
    expiresAt: refundLocktime === null ? null : refundLocktime * 1_000,
    txid: fundingTxid,
    swapId: id,
    refundable: status === 'refundable' && !refundTxid,
    providerData: {
      destination: text(snapshot.client_lightning_invoice),
      invoice: text(snapshot.client_lightning_invoice),
      fundingAddress: text(snapshot.arkade_vhtlc_address),
      fundingTxid,
      completionTxid: text(snapshot.arkade_claim_txid),
      refundTxid,
      providerStatus: displaySatoraStatus(providerStatus),
      sendAmountSats,
    },
  };
}

export function toSatoraSwapRecord(stored: SatoraStoredSwap): PaymentRecord {
  const payment = toSatoraPaymentRecord(stored);
  if (payment) return payment;

  const snapshot = stored.response as unknown as SatoraSwapSnapshot;
  const id = text(snapshot.id) ?? stored.swapId;
  const direction = snapshot.direction === 'arkade_to_lightning'
    ? 'outgoing'
    : 'incoming';
  const layer = snapshot.direction === 'btc_to_arkade'
    ? 'onchain'
    : 'lightning';
  const receiveAmountSats = wholeSats(snapshot.target_amount) ?? 0;
  const sendAmountSats = wholeSats(snapshot.source_amount) ?? receiveAmountSats;
  const rawCreatedAt = text(snapshot.created_at);
  const parsedCreatedAt = rawCreatedAt ? Date.parse(rawCreatedAt) : NaN;
  const createdAt = Number.isFinite(parsedCreatedAt)
    ? parsedCreatedAt
    : stored.storedAt;
  const invoiceExpiresAt = wholeSats(snapshot.alice_invoice_expires_at);
  const refundLocktime = layer === 'onchain'
    ? wholeSats(snapshot.btc_refund_locktime)
    : wholeSats(snapshot.vhtlc_refund_locktime);
  const expiresAt = invoiceExpiresAt
    ?? (refundLocktime === null ? null : refundLocktime * 1_000);
  const providerStatus = text(snapshot.status) ?? 'pending';
  const status: PaymentStatus = providerStatus === 'expired'
    || (expiresAt !== null && expiresAt <= Date.now())
    ? 'expired'
    : providerStatus === 'pending'
      ? 'created'
      : mapSatoraPaymentStatus(providerStatus, false);

  return {
    id,
    provider: 'satora',
    layer,
    direction,
    amountSats: receiveAmountSats,
    feeSats: Math.max(0, sendAmountSats - receiveAmountSats),
    status,
    createdAt,
    expiresAt,
    swapId: id,
    refundable: false,
    providerData: {
      destination: direction === 'outgoing'
        ? text(snapshot.client_lightning_invoice)
        : text(snapshot.target_arkade_address),
      invoice: text(snapshot.bolt11_invoice)
        ?? text(snapshot.client_lightning_invoice),
      fundingAddress: layer === 'onchain'
        ? text(snapshot.btc_htlc_address)
        : text(snapshot.arkade_vhtlc_address),
      fundingTxid: layer === 'onchain'
        ? text(snapshot.btc_fund_txid)
        : text(snapshot.arkade_fund_txid),
      arkadeFundingTxid: text(snapshot.arkade_fund_txid),
      completionTxid: text(snapshot.arkade_claim_txid)
        ?? text(snapshot.alice_claim_txid),
      refundTxid: text(snapshot.alice_refund_txid),
      providerStatus: displaySatoraStatus(providerStatus),
      sendAmountSats,
    },
  };
}
