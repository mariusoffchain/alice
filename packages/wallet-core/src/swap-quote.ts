import { quoteArkToLightning } from './boltz-quote.ts';
import { SWAP_PROVIDER, type SwapProvider } from './network-config.ts';
import type { ParsedPaymentRequest, PaymentQuote } from './payment-types.ts';
import { quoteArkToLightningWithSatora } from './satora-quote.ts';

export async function quoteArkToLightningForProvider(
  request: ParsedPaymentRequest,
  receiveAmountSats?: number,
  provider: SwapProvider = SWAP_PROVIDER,
): Promise<PaymentQuote> {
  if (provider === 'satora') {
    return quoteArkToLightningWithSatora(request, receiveAmountSats);
  }
  return quoteArkToLightning(request, receiveAmountSats);
}
