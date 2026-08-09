import type { IWallet } from '@arkade-os/sdk';
import {
  ArkadeSwaps,
  BoltzSwapProvider,
  IndexedDbSwapRepository,
  isChainFailedStatus,
  isChainRefundableStatus,
  isChainSuccessStatus,
  isPendingChainSwap,
  isPendingReverseSwap,
  isPendingSubmarineSwap,
  isReverseFailedStatus,
  isReverseSuccessStatus,
  isSubmarineFailedStatus,
  isSubmarineRefundableStatus,
  isSubmarineSuccessStatus,
  getInvoiceSatoshis,
  type BoltzChainSwap,
  type BoltzReverseSwap,
  type BoltzSubmarineSwap,
} from '@arkade-os/boltz-swap';
import { createArkadeCacheSwapRepository } from './arkade-cache-repositories';
import { quoteArkToBitcoin, quoteArkToLightning } from './boltz-quote';
import type { PaymentRail } from './payment-rail';
import type {
  ParsedPaymentRequest,
  PaymentQuote,
  PaymentRecord,
  PaymentStatus,
  ReceivePaymentRequest,
  ReceivePaymentResponse,
} from './payment-types';
import { consumeRefundTest } from './refund-test';
import { BOLTZ_URL, PAYMENT_NETWORK } from './network-config';

const SWAP_DB_NAME = 'alice-boltz-swaps';

export async function clearLegacyWebBoltzState(
  cacheMnemonic?: string,
): Promise<void> {
  const repository = cacheMnemonic
    ? createArkadeCacheSwapRepository(cacheMnemonic)
    : new IndexedDbSwapRepository(SWAP_DB_NAME);
  await repository.clear();
  await repository[Symbol.asyncDispose]();
}

type AliceChainSwap = BoltzChainSwap & {
  fundingTxid?: string;
  completionTxid?: string;
  refundTestMode?: boolean;
};

type AliceSubmarineSwap = BoltzSubmarineSwap & {
  fundingTxid?: string;
};

function mapChainStatus(swap: BoltzChainSwap): PaymentStatus {
  if (isChainSuccessStatus(swap.status)) return 'settled';
  if (swap.status === 'transaction.refunded') return 'refunded';
  if (isChainRefundableStatus(swap.status)) return 'refundable';
  if (isChainFailedStatus(swap.status)) return 'failed';
  return 'pending';
}

function mapSubmarineStatus(swap: BoltzSubmarineSwap): PaymentStatus {
  if (isSubmarineSuccessStatus(swap.status)) return 'settled';
  if (swap.refunded === true || swap.status === 'transaction.refunded') return 'refunded';
  if (isSubmarineRefundableStatus(swap.status)) return 'refundable';
  if (isSubmarineFailedStatus(swap.status)) return 'failed';
  return 'pending';
}

function mapReverseStatus(swap: BoltzReverseSwap): PaymentStatus {
  if (isReverseSuccessStatus(swap.status)) return 'settled';
  if (isReverseFailedStatus(swap.status)) return 'failed';
  return 'pending';
}

function toChainPaymentRecord(swap: BoltzChainSwap): PaymentRecord {
  const aliceSwap = swap as AliceChainSwap;
  const sendAmountSats = swap.response.lockupDetails.amount;
  return {
    id: swap.id,
    provider: 'boltz',
    layer: swap.request.from === 'ARK' ? 'onchain' : 'arkade',
    direction: swap.request.from === 'ARK' ? 'outgoing' : 'incoming',
    amountSats: swap.amount,
    feeSats: Math.max(0, sendAmountSats - swap.amount),
    status: mapChainStatus(swap),
    createdAt: swap.createdAt * 1000,
    expiresAt: null,
    txid: aliceSwap.completionTxid,
    swapId: swap.id,
    refundable: isChainRefundableStatus(swap.status),
    providerData: {
      destination: swap.toAddress,
      fundingTxid: aliceSwap.fundingTxid,
      sendAmountSats,
      refundTestMode: aliceSwap.refundTestMode === true,
    },
  };
}

function toSubmarinePaymentRecord(swap: BoltzSubmarineSwap): PaymentRecord {
  const aliceSwap = swap as AliceSubmarineSwap;
  const receiveAmountSats = getInvoiceSatoshis(swap.request.invoice);
  const sendAmountSats = swap.response.expectedAmount;
  return {
    id: swap.id,
    provider: 'boltz',
    layer: 'lightning',
    direction: 'outgoing',
    amountSats: receiveAmountSats,
    feeSats: Math.max(0, sendAmountSats - receiveAmountSats),
    status: mapSubmarineStatus(swap),
    createdAt: swap.createdAt * 1000,
    expiresAt: null,
    txid: aliceSwap.fundingTxid,
    swapId: swap.id,
    preimage: swap.preimage,
    refundable: isSubmarineRefundableStatus(swap.status) && swap.refunded !== true,
    providerData: {
      destination: swap.request.invoice,
      fundingTxid: aliceSwap.fundingTxid,
      sendAmountSats,
    },
  };
}

function toReversePaymentRecord(swap: BoltzReverseSwap): PaymentRecord {
  const receiveAmountSats = swap.response.onchainAmount ?? swap.request.invoiceAmount;
  return {
    id: swap.id,
    provider: 'boltz',
    layer: 'lightning',
    direction: 'incoming',
    amountSats: receiveAmountSats,
    feeSats: Math.max(0, swap.request.invoiceAmount - receiveAmountSats),
    status: mapReverseStatus(swap),
    createdAt: swap.createdAt * 1000,
    expiresAt: null,
    swapId: swap.id,
    preimage: swap.preimage,
    refundable: false,
    providerData: {
      destination: swap.response.invoice,
      invoice: swap.response.invoice,
      sendAmountSats: swap.request.invoiceAmount,
    },
  };
}

export class BoltzWebPaymentRail implements PaymentRail {
  readonly id = 'boltz';
  readonly supportedLayers = ['onchain', 'lightning'] as const;

  private constructor(
    private readonly wallet: IWallet,
    private readonly swaps: ArkadeSwaps,
    private readonly swapProvider: BoltzSwapProvider,
  ) {}

  static async create(wallet: IWallet, cacheMnemonic?: string): Promise<BoltzWebPaymentRail> {
    const swapProvider = new BoltzSwapProvider({
      apiUrl: BOLTZ_URL,
      network: PAYMENT_NETWORK,
      referralId: 'alice-wallet',
    });
    const swaps = await ArkadeSwaps.create({
      wallet,
      swapProvider,
      swapRepository: cacheMnemonic
        ? createArkadeCacheSwapRepository(cacheMnemonic)
        : new IndexedDbSwapRepository(SWAP_DB_NAME),
      swapManager: true,
    });
    // Keep the locally persisted swap records available when the provider is
    // temporarily unreachable (notably during an offline wallet reset).
    await swaps.refreshSwapsStatus().catch(() => {});
    return new BoltzWebPaymentRail(wallet, swaps, swapProvider);
  }

  canHandle(request: ParsedPaymentRequest): boolean {
    return request.routes.some(route => route.layer === 'onchain' || route.layer === 'lightning');
  }

  private async recordForSwap(swap: BoltzChainSwap): Promise<PaymentRecord> {
    const record = toChainPaymentRecord(swap);
    if (record.txid || record.status !== 'settled') return record;
    const remote = await this.swaps.getSwapStatus(swap.id).catch(() => null);
    return remote?.transaction?.id ? { ...record, txid: remote.transaction.id } : record;
  }

  private recordForSubmarineSwap(swap: BoltzSubmarineSwap): PaymentRecord {
    return toSubmarinePaymentRecord(swap);
  }

  private recordForReverseSwap(swap: BoltzReverseSwap): PaymentRecord {
    return toReversePaymentRecord(swap);
  }

  quote(request: ParsedPaymentRequest, amountSats?: number): Promise<PaymentQuote> {
    const amount = amountSats ?? request.amountSats;
    if (request.routes.some(route => route.layer === 'lightning' && route.format === 'bolt11')) {
      return quoteArkToLightning(request, amount ?? undefined);
    }
    if (!amount) return Promise.reject(new Error('A payment amount is required.'));
    return quoteArkToBitcoin(request, amount);
  }

  async send(quote: PaymentQuote): Promise<PaymentRecord> {
    if (quote.provider !== this.id || (quote.layer !== 'onchain' && quote.layer !== 'lightning')) {
      throw new Error('This Boltz quote is not supported.');
    }
    if (quote.expiresAt !== null && Date.now() >= quote.expiresAt) {
      throw new Error('The payment quote expired. Request a new quote.');
    }

    if (quote.layer === 'lightning') {
      const route = quote.request.routes.find(candidate => candidate.layer === 'lightning' && candidate.format === 'bolt11');
      if (!route) throw new Error('Lightning invoice missing from quote.');

      const result = await this.swaps.sendLightningPayment({
        invoice: route.destination,
        waitFor: 'funded',
      });
      const swap = (await this.swaps.getSwapHistory())
        .filter(isPendingSubmarineSwap)
        .find(candidate => candidate.request.invoice === route.destination);

      if (swap) {
        const fundedSwap = Object.assign(swap, { fundingTxid: result.txid }) as AliceSubmarineSwap;
        await this.swaps.swapRepository.saveSwap(fundedSwap);
        return {
          ...toSubmarinePaymentRecord(fundedSwap),
          status: 'pending',
          refundable: false,
        };
      }

      return {
        id: `lightning-${result.txid}`,
        provider: 'boltz',
        layer: 'lightning',
        direction: 'outgoing',
        amountSats: quote.receiveAmountSats,
        feeSats: Math.max(0, result.amount - quote.receiveAmountSats),
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: null,
        txid: result.txid,
        refundable: false,
        providerData: {
          destination: route.destination,
          sendAmountSats: result.amount,
        },
      };
    }

    const route = quote.request.routes.find(candidate => candidate.layer === 'onchain');
    if (!route) throw new Error('Bitcoin destination missing from quote.');

    const freshQuote = await quoteArkToBitcoin(quote.request, quote.receiveAmountSats);
    if (freshQuote.sendAmountSats !== quote.sendAmountSats) {
      throw new Error('Boltz fees changed. Review and confirm the updated quote.');
    }

    const created = await this.swaps.arkToBtc({
      btcAddress: route.destination,
      receiverLockAmount: quote.receiveAmountSats,
    });
    if (created.amountToPay > freshQuote.sendAmountSats) {
      // The swap has not been funded yet, so it is safe to stop monitoring and
      // delete its local recovery data before asking the user to review again.
      await this.swaps.getSwapManager()?.removeSwap(created.pendingSwap.id).catch(() => {});
      await this.swaps.swapRepository.deleteSwap(created.pendingSwap.id).catch(() => {});
      throw new Error('The final Boltz amount exceeds the confirmed total. No funds were sent.');
    }

    const refundTestMode = await consumeRefundTest();
    if (refundTestMode) await this.swaps.stopSwapManager();

    let fundingTxid: string;
    try {
      fundingTxid = await this.wallet.send({ address: created.arkAddress, amount: created.amountToPay });
    } catch (error) {
      if (refundTestMode) await this.swaps.startSwapManager().catch(() => {});
      throw error;
    }
    const fundedSwap = Object.assign(created.pendingSwap, { fundingTxid, refundTestMode }) as AliceChainSwap;
    await this.swaps.swapRepository.saveSwap(fundedSwap);

    // Once Arkade funding is persisted, the UI can safely return control to
    // the user. SwapManager keeps monitoring and will resume from IndexedDB if
    // the PWA is closed. While this page remains open, retain the final Bitcoin
    // txid as additional display metadata.
    if (!refundTestMode) {
      void this.swaps.waitAndClaimBtc(fundedSwap)
        .then(async claimed => {
          Object.assign(fundedSwap, {
            completionTxid: claimed.txid,
            status: 'transaction.claimed',
          });
          await this.swaps.swapRepository.saveSwap(fundedSwap);
        })
        .catch(() => {});
    }

    return {
      ...toChainPaymentRecord(fundedSwap),
      amountSats: quote.receiveAmountSats,
      feeSats: created.amountToPay - quote.receiveAmountSats,
      status: 'pending',
      refundable: false,
    };
  }

  async createReceiveRequest(request: ReceivePaymentRequest): Promise<ReceivePaymentResponse> {
    if (request.layer !== 'lightning') {
      throw new Error('Only Lightning receive is available through Boltz for now.');
    }
    if (!Number.isSafeInteger(request.amountSats) || !request.amountSats || request.amountSats <= 0) {
      throw new Error('Enter a valid Lightning amount in sats.');
    }
    const limits = await this.swapProvider.getLimits();
    if (request.amountSats < limits.min) {
      throw new Error(`Lightning amount too small. Minimum: ${limits.min.toLocaleString('en-US')} sats.`);
    }

    const result = await this.swaps.createLightningInvoice({
      amount: request.amountSats,
      description: request.description,
    });

    return {
      request: result.invoice,
      layer: 'lightning',
      amountSats: result.amount ?? request.amountSats,
      expiresAt: result.expiry ? result.expiry * 1000 : null,
      paymentId: result.pendingSwap.id,
    };
  }

  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    const swap = (await this.swaps.getSwapHistory())
      .find(candidate => candidate.id === paymentId);
    if (swap && isPendingChainSwap(swap)) return this.recordForSwap(swap);
    if (swap && isPendingSubmarineSwap(swap)) return this.recordForSubmarineSwap(swap);
    if (swap && isPendingReverseSwap(swap)) return this.recordForReverseSwap(swap);
    return null;
  }

  async listPayments(): Promise<PaymentRecord[]> {
    const swaps = await this.swaps.getSwapHistory();
    const chainRecords = swaps
      .filter(isPendingChainSwap)
      .map(toChainPaymentRecord);
    const lightningRecords = swaps
      .filter(isPendingSubmarineSwap)
      .map(swap => this.recordForSubmarineSwap(swap));
    const reverseRecords = swaps
      .filter(isPendingReverseSwap)
      .map(swap => this.recordForReverseSwap(swap));
    return [...chainRecords, ...lightningRecords, ...reverseRecords];
  }

  listSwapRecords(): Promise<PaymentRecord[]> {
    return this.listPayments();
  }

  async refund(paymentId: string): Promise<PaymentRecord> {
    const swap = (await this.swaps.getSwapHistory())
      .find(candidate => candidate.id === paymentId);
    if (!swap) throw new Error('Swap not found.');
    if (isPendingChainSwap(swap)) {
      if (!isChainRefundableStatus(swap.status)) throw new Error('This chain swap is not refundable yet.');
      await this.swaps.refundArk(swap);
    } else if (isPendingSubmarineSwap(swap)) {
      if (!isSubmarineRefundableStatus(swap.status)) throw new Error('This Lightning payment is not refundable yet.');
      await this.swaps.refundVHTLC(swap);
    } else {
      throw new Error('Swap not found.');
    }
    await this.swaps.refreshSwapsStatus();
    return (await this.getPayment(paymentId)) ?? (isPendingChainSwap(swap) ? this.recordForSwap(swap) : this.recordForSubmarineSwap(swap));
  }

  refresh(): Promise<void> {
    return this.swaps.refreshSwapsStatus();
  }

  clear(): Promise<void> {
    return this.swaps.reset();
  }

  dispose(): Promise<void> {
    return this.swaps.dispose();
  }
}
