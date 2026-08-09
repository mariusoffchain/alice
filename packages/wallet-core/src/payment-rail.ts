import type {
  ParsedPaymentRequest,
  PaymentLayer,
  PaymentQuote,
  PaymentRecord,
  ReceivePaymentRequest,
  ReceivePaymentResponse,
} from './payment-types';

/**
 * Transport-neutral payment interface consumed by the UI.
 * Implementations own SDK-specific state and never expose wallet internals.
 */
export interface PaymentRail {
  readonly id: string;
  readonly supportedLayers: readonly PaymentLayer[];

  canHandle(request: ParsedPaymentRequest): boolean;
  quote(request: ParsedPaymentRequest, amountSats?: number): Promise<PaymentQuote>;
  send(quote: PaymentQuote): Promise<PaymentRecord>;
  createReceiveRequest(request: ReceivePaymentRequest): Promise<ReceivePaymentResponse>;
  getPayment(paymentId: string): Promise<PaymentRecord | null>;
  listPayments(): Promise<PaymentRecord[]>;
  listSwapRecords?(): Promise<PaymentRecord[]>;
  refund(paymentId: string): Promise<PaymentRecord>;
  refresh(): Promise<void>;
  clear(): Promise<void>;
  dispose(): Promise<void>;
}
