import { BoltzSwapProvider, getInvoiceSatoshis } from '@arkade-os/boltz-swap';
import type { ParsedPaymentRequest, PaymentQuote } from './payment-types';
import { BOLTZ_URL, PAYMENT_NETWORK } from './network-config';

const QUOTE_TTL_MS = 60_000;

let boltzProvider: BoltzSwapProvider | null = null;

function getBoltzProvider(): BoltzSwapProvider {
  if (!boltzProvider) {
    boltzProvider = new BoltzSwapProvider({
      apiUrl: BOLTZ_URL,
      network: PAYMENT_NETWORK,
      referralId: 'alice-wallet',
    });
  }
  return boltzProvider;
}

export async function quoteArkToBitcoin(
  request: ParsedPaymentRequest,
  receiveAmountSats: number,
): Promise<PaymentQuote> {
  if (!Number.isSafeInteger(receiveAmountSats) || receiveAmountSats <= 0) {
    throw new Error('Enter a valid whole number of sats.');
  }

  const route = request.routes.find(candidate => candidate.layer === 'onchain');
  if (!route) throw new Error('A valid Mutinynet Bitcoin address is required.');

  const provider = getBoltzProvider();
  const [fees, limits] = await Promise.all([
    provider.getChainFees('ARK', 'BTC'),
    provider.getChainLimits('ARK', 'BTC'),
  ]);

  const percentageRate = fees.percentage / 100;
  if (percentageRate < 0 || percentageRate >= 1) {
    throw new Error('Boltz returned an invalid percentage fee.');
  }

  // For a chain swap Boltz charges its percentage on the user lock amount,
  // not on the amount the recipient gets. The BTC claim fee is first added to
  // the desired receive amount to form the server lock amount, then the user
  // lock amount is grossed up for Boltz's percentage and server miner fee.
  // See Boltz's "Given server lock amount" chain-swap formula.
  const serverLockAmount = receiveAmountSats + fees.minerFees.user.claim;
  const sendAmountSats = Math.ceil(
    (serverLockAmount + fees.minerFees.server) / (1 - percentageRate),
  );
  const feeSats = sendAmountSats - receiveAmountSats;

  // Boltz enforces chain limits on the user lock amount (the total sent).
  if (sendAmountSats < limits.min) {
    throw new Error(`Boltz minimum total: ${limits.min.toLocaleString('en-US')} sats.`);
  }
  if (sendAmountSats > limits.max) {
    throw new Error(`Boltz maximum total: ${limits.max.toLocaleString('en-US')} sats.`);
  }

  return {
    id: `boltz-ark-btc-${Date.now()}`,
    provider: 'boltz',
    layer: 'onchain',
    request,
    sendAmountSats,
    receiveAmountSats,
    feeSats,
    expiresAt: Date.now() + QUOTE_TTL_MS,
    warnings: ['The final quote is rechecked before a swap is created.'],
    providerData: {
      direction: 'ARK_TO_BTC',
      destination: route.destination,
      percentage: fees.percentage,
      limits,
    },
  };
}

export async function quoteArkToLightning(
  request: ParsedPaymentRequest,
  receiveAmountSats?: number,
): Promise<PaymentQuote> {
  const route = request.routes.find(candidate => candidate.layer === 'lightning' && candidate.format === 'bolt11');
  if (!route) throw new Error('A valid Mutinynet Lightning invoice is required.');

  const invoiceAmountSats = receiveAmountSats ?? request.amountSats ?? getInvoiceSatoshis(route.destination);
  if (!Number.isSafeInteger(invoiceAmountSats) || invoiceAmountSats <= 0) {
    throw new Error('This first Lightning version requires an invoice with a fixed amount.');
  }

  const provider = getBoltzProvider();
  const [fees, limits] = await Promise.all([
    provider.getFees(),
    provider.getLimits(),
  ]);

  const percentageRate = fees.submarine.percentage / 100;
  if (percentageRate < 0 || percentageRate >= 1) {
    throw new Error('Boltz returned an invalid Lightning percentage fee.');
  }

  const sendAmountSats = Math.ceil(invoiceAmountSats / (1 - percentageRate) + fees.submarine.minerFees);
  const feeSats = sendAmountSats - invoiceAmountSats;

  if (invoiceAmountSats < limits.min) {
    throw new Error(`Boltz Lightning minimum: ${limits.min.toLocaleString('en-US')} sats.`);
  }
  if (invoiceAmountSats > limits.max) {
    throw new Error(`Boltz Lightning maximum: ${limits.max.toLocaleString('en-US')} sats.`);
  }

  return {
    id: `boltz-ark-ln-${Date.now()}`,
    provider: 'boltz',
    layer: 'lightning',
    request,
    sendAmountSats,
    receiveAmountSats: invoiceAmountSats,
    feeSats,
    expiresAt: Date.now() + QUOTE_TTL_MS,
    warnings: ['Lightning fees are rechecked by Boltz when the payment is sent.'],
    providerData: {
      direction: 'ARK_TO_LIGHTNING',
      invoice: route.destination,
      percentage: fees.submarine.percentage,
      limits,
    },
  };
}
