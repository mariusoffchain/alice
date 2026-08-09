import type { PaymentRail } from './payment-rail.ts';
import type {
  ParsedPaymentRequest,
  PaymentQuote,
  PaymentRecord,
  ReceivePaymentRequest,
  ReceivePaymentResponse,
} from './payment-types.ts';

export class CompositePaymentRail implements PaymentRail {
  readonly id = 'composite';
  readonly supportedLayers;
  private readonly primary: PaymentRail;
  private readonly fallback: PaymentRail;

  constructor(
    primary: PaymentRail,
    fallback: PaymentRail,
  ) {
    this.primary = primary;
    this.fallback = fallback;
    this.supportedLayers = [
      ...new Set([...primary.supportedLayers, ...fallback.supportedLayers]),
    ];
  }

  canHandle(request: ParsedPaymentRequest): boolean {
    return this.primary.canHandle(request) || this.fallback.canHandle(request);
  }

  quote(request: ParsedPaymentRequest, amountSats?: number): Promise<PaymentQuote> {
    return this.primary.canHandle(request)
      ? this.primary.quote(request, amountSats)
      : this.fallback.quote(request, amountSats);
  }

  send(quote: PaymentQuote): Promise<PaymentRecord> {
    return quote.provider === this.primary.id
      ? this.primary.send(quote)
      : this.fallback.send(quote);
  }

  createReceiveRequest(
    request: ReceivePaymentRequest,
  ): Promise<ReceivePaymentResponse> {
    return this.primary.supportedLayers.includes(request.layer)
      ? this.primary.createReceiveRequest(request)
      : this.fallback.createReceiveRequest(request);
  }

  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    return await this.primary.getPayment(paymentId)
      ?? this.fallback.getPayment(paymentId);
  }

  async listPayments(): Promise<PaymentRecord[]> {
    const [primary, fallback] = await Promise.all([
      this.primary.listPayments(),
      this.fallback.listPayments(),
    ]);
    return [...primary, ...fallback];
  }

  async listSwapRecords(): Promise<PaymentRecord[]> {
    const [primary, fallback] = await Promise.all([
      this.primary.listSwapRecords?.() ?? this.primary.listPayments(),
      this.fallback.listSwapRecords?.() ?? this.fallback.listPayments(),
    ]);
    return [...primary, ...fallback];
  }

  async refund(paymentId: string): Promise<PaymentRecord> {
    return await this.primary.getPayment(paymentId)
      ? this.primary.refund(paymentId)
      : this.fallback.refund(paymentId);
  }

  async refresh(): Promise<void> {
    await Promise.all([this.primary.refresh(), this.fallback.refresh()]);
  }

  async clear(): Promise<void> {
    await Promise.all([this.primary.clear(), this.fallback.clear()]);
  }

  async dispose(): Promise<void> {
    await Promise.all([this.primary.dispose(), this.fallback.dispose()]);
  }
}
