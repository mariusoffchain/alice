import type { PaymentRecord } from './payment-types';

export function settledIncomingAmount(payment: PaymentRecord | null): number | null {
  if (
    !payment
    || payment.direction !== 'incoming'
    || payment.status !== 'settled'
    || !Number.isSafeInteger(payment.amountSats)
    || payment.amountSats <= 0
  ) {
    return null;
  }
  return payment.amountSats;
}
