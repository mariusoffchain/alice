import type { PaymentRecord } from './payment-types';

export function getUnsafeResetPayments(payments: PaymentRecord[]): PaymentRecord[] {
  return payments.filter(payment => payment.status === 'pending' || payment.status === 'refundable');
}

export function pendingResetWarning(count: number): string {
  return `Wallet reset blocked: ${count} payment swap${count === 1 ? ' is' : 's are'} still pending or refundable. Settle or refund ${count === 1 ? 'it' : 'them'} first.`;
}
