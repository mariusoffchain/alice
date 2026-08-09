import type { IWallet } from '@arkade-os/sdk';
import { decodeInvoice } from '@arkade-os/boltz-swap';
import { bech32 } from '@scure/base';
import { Client } from '@satora/swap';
import { ASP_URL, ESPLORA_URL, SATORA_URL } from './network-config.ts';
import type { PaymentRail } from './payment-rail.ts';
import type {
  ParsedPaymentRequest,
  PaymentQuote,
  PaymentRecord,
  ReceivePaymentRequest,
  ReceivePaymentResponse,
} from './payment-types.ts';
import {
  hasSatoraFundingEvidence,
  toSatoraPaymentRecord,
  toSatoraSwapRecord,
  type SatoraSwapSnapshot,
} from './satora-payment-record.ts';
import { quoteArkToLightningWithSatora } from './satora-quote.ts';
import { deriveSatoraXprv } from './satora-key-derivation.ts';
import {
  createAliceSatoraStorage,
  type AliceSatoraSwapStorage,
  type AliceSatoraWalletStorage,
  type SatoraKeyValueStore,
  type SatoraStoredSwap,
} from './satora-storage.ts';

type SatoraFundingWallet = Pick<
  IWallet,
  'send' | 'getAddress' | 'getBoardingAddress'
>;

type CreateSwapResult = {
  response: {
    id: string;
    status: string;
    source_amount: string;
    target_amount: string;
    arkade_vhtlc_address: string;
    client_lightning_invoice: string;
  };
};

type CreateReceiveSwapResult = {
  response: {
    id: string;
    status: string;
    source_amount: string;
    target_amount: string;
    arkade_vhtlc_address: string;
    target_arkade_address: string;
    bolt11_invoice: string;
  };
};

type CreateBitcoinReceiveSwapResult = {
  response: {
    id: string;
    status: string;
    source_amount: string;
    target_amount: string;
    btc_htlc_address: string;
    btc_refund_locktime: number;
    target_arkade_address: string;
  };
};

type RefundResult = {
  success: boolean;
  message: string;
  txId?: string;
  broadcast?: boolean;
};

export interface SatoraClientLike {
  createArkadeToLightningSwap(options: {
    lightningInvoice: string;
  }): Promise<CreateSwapResult>;
  createLightningToArkadeSwap(options: {
    satsReceive: number;
    targetAddress: string;
    invoiceDescription?: string;
  }): Promise<CreateReceiveSwapResult>;
  createBitcoinToArkadeSwap(options: {
    satsReceive: number;
    targetAddress: string;
  }): Promise<CreateBitcoinReceiveSwapResult>;
  getSwap(
    id: string,
    options?: { updateStorage?: boolean },
  ): Promise<unknown>;
  listAllSwaps(): Promise<SatoraStoredSwap[]>;
  refundSwap(
    id: string,
    options: { destinationAddress: string },
  ): Promise<RefundResult>;
  claimArkade(
    id: string,
    options: { destinationAddress: string },
  ): Promise<{
    success: boolean;
    message: string;
    txId?: string;
    claimAmount?: bigint;
  }>;
  closeSwapStatusSocket(): void;
}

type QuoteFunction = (
  request: ParsedPaymentRequest,
  receiveAmountSats?: number,
) => Promise<PaymentQuote>;

type InvoiceDecoder = (invoice: string) => {
  amountSats: number;
  expiry: number;
};

function bolt11Timestamp(invoice: string): number {
  const decoded = bech32.decode(
    invoice.toLowerCase() as `${string}1${string}`,
    5_000,
  );
  if (decoded.words.length < 7) {
    throw new Error('Satora returned a Lightning invoice without a timestamp.');
  }
  return decoded.words.slice(0, 7).reduce(
    (timestamp, word) => timestamp * 32 + word,
    0,
  );
}

export function absoluteBolt11Expiry(
  invoice: string,
  decodedExpiry: number,
): number {
  const timestamp = bolt11Timestamp(invoice);
  return decodedExpiry >= timestamp
    ? decodedExpiry
    : timestamp + decodedExpiry;
}

function decodeSatoraInvoice(invoice: string): ReturnType<InvoiceDecoder> {
  const decoded = decodeInvoice(invoice);
  return {
    amountSats: decoded.amountSats,
    expiry: absoluteBolt11Expiry(invoice, decoded.expiry),
  };
}

function wholeSats(value: unknown, label: string): number {
  const parsed = typeof value === 'string' && value.trim()
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) <= 0) {
    throw new Error(`Satora returned an invalid ${label}. No funds were sent.`);
  }
  return Number(parsed);
}

export function bitcoinPaymentUri(address: string, amountSats: number): string {
  const amountBtc = (amountSats / 100_000_000)
    .toFixed(8)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
  return `bitcoin:${address}?amount=${amountBtc}`;
}

function snapshot(stored: SatoraStoredSwap): SatoraSwapSnapshot {
  return stored.response as unknown as SatoraSwapSnapshot;
}

function isSameInvoice(stored: SatoraStoredSwap, invoice: string): boolean {
  return snapshot(stored).direction === 'arkade_to_lightning'
    && snapshot(stored).client_lightning_invoice === invoice;
}

export class SatoraPaymentRail implements PaymentRail {
  readonly id = 'satora';
  readonly supportedLayers = ['onchain', 'lightning'] as const;
  private readonly inFlightQuotes = new Set<string>();
  private readonly inFlightClaims = new Set<string>();
  private readonly wallet: SatoraFundingWallet;
  private readonly client: SatoraClientLike;
  private readonly walletStorage: AliceSatoraWalletStorage;
  private readonly swapStorage: AliceSatoraSwapStorage;
  private readonly quoteFunction: QuoteFunction;
  private readonly invoiceDecoder: InvoiceDecoder;

  constructor(
    wallet: SatoraFundingWallet,
    client: SatoraClientLike,
    walletStorage: AliceSatoraWalletStorage,
    swapStorage: AliceSatoraSwapStorage,
    quoteFunction: QuoteFunction = quoteArkToLightningWithSatora,
    invoiceDecoder: InvoiceDecoder = decodeSatoraInvoice,
  ) {
    this.wallet = wallet;
    this.client = client;
    this.walletStorage = walletStorage;
    this.swapStorage = swapStorage;
    this.quoteFunction = quoteFunction;
    this.invoiceDecoder = invoiceDecoder;
  }

  static async create(
    wallet: IWallet,
    mnemonic: string,
    values: SatoraKeyValueStore,
  ): Promise<SatoraPaymentRail> {
    if (!SATORA_URL) throw new Error('Satora is not configured for this network.');
    const { walletStorage, swapStorage } = createAliceSatoraStorage(mnemonic, values);
    const satoraXprv = deriveSatoraXprv(mnemonic);
    const client = await Client.builder()
      .withoutTracking()
      .withBaseUrl(SATORA_URL)
      .withArkadeServerUrl(ASP_URL)
      .withEsploraUrl(ESPLORA_URL)
      .withReferralCode('alice-wallet')
      .withSignerStorage(walletStorage)
      .withSwapStorage(swapStorage)
      .withXprv(satoraXprv)
      .build();
    return new SatoraPaymentRail(
      wallet,
      client as SatoraClientLike,
      walletStorage,
      swapStorage,
    );
  }

  canHandle(request: ParsedPaymentRequest): boolean {
    return request.routes.some(
      route => route.layer === 'lightning' && route.format === 'bolt11',
    );
  }

  quote(
    request: ParsedPaymentRequest,
    amountSats?: number,
  ): Promise<PaymentQuote> {
    return this.quoteFunction(request, amountSats ?? request.amountSats ?? undefined);
  }

  async send(quote: PaymentQuote): Promise<PaymentRecord> {
    if (quote.provider !== this.id || quote.layer !== 'lightning') {
      throw new Error('This Satora quote is not supported.');
    }
    if (quote.expiresAt !== null && Date.now() >= quote.expiresAt) {
      throw new Error('The payment quote expired. Request a new quote.');
    }
    if (this.inFlightQuotes.has(quote.id)) {
      throw new Error('This payment is already being processed.');
    }

    const route = quote.request.routes.find(
      candidate => candidate.layer === 'lightning' && candidate.format === 'bolt11',
    );
    if (!route) throw new Error('Lightning invoice missing from quote.');

    const existing = (await this.swapStorage.getAll()).find(
      stored => isSameInvoice(stored, route.destination),
    );
    if (existing) {
      throw new Error('This Lightning invoice already has a Satora payment record.');
    }

    this.inFlightQuotes.add(quote.id);
    try {
      const freshQuote = await this.quoteFunction(
        quote.request,
        quote.receiveAmountSats,
      );
      if (
        freshQuote.receiveAmountSats !== quote.receiveAmountSats
        || freshQuote.sendAmountSats !== quote.sendAmountSats
      ) {
        throw new Error('Satora fees changed. Review and confirm the updated quote.');
      }

      const created = await this.client.createArkadeToLightningSwap({
        lightningInvoice: route.destination,
      });
      const sourceAmountSats = wholeSats(
        created.response.source_amount,
        'source amount',
      );
      const targetAmountSats = wholeSats(
        created.response.target_amount,
        'target amount',
      );
      if (
        sourceAmountSats !== freshQuote.sendAmountSats
        || targetAmountSats !== freshQuote.receiveAmountSats
      ) {
        throw new Error(
          'The Satora swap does not match the confirmed payment details. No funds were sent.',
        );
      }
      if (!created.response.arkade_vhtlc_address.trim()) {
        throw new Error('Satora returned an invalid funding address. No funds were sent.');
      }

      const stored = await this.swapStorage.get(created.response.id);
      if (!stored) {
        throw new Error(
          'Satora recovery data was not persisted. No funds were sent.',
        );
      }

      await this.swapStorage.update(
        created.response.id,
        {
          ...stored.response,
          alice_funding_attempted: true,
        } as unknown as typeof stored.response,
      );

      const fundingTxid = await this.wallet.send({
        address: created.response.arkade_vhtlc_address,
        amount: sourceAmountSats,
      });

      const fundedStored = await this.swapStorage.get(created.response.id);
      if (fundedStored) {
        await this.swapStorage.update(
          created.response.id,
          {
            ...fundedStored.response,
            arkade_fund_txid: fundingTxid,
          } as typeof fundedStored.response,
        ).catch(() => {});
      }

      return {
        id: created.response.id,
        provider: 'satora',
        layer: 'lightning',
        direction: 'outgoing',
        amountSats: targetAmountSats,
        feeSats: sourceAmountSats - targetAmountSats,
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: null,
        txid: fundingTxid,
        swapId: created.response.id,
        refundable: false,
        providerData: {
          destination: route.destination,
          invoice: route.destination,
          fundingAddress: created.response.arkade_vhtlc_address,
          fundingTxid,
          providerStatus: created.response.status,
          sendAmountSats: sourceAmountSats,
        },
      };
    } finally {
      this.inFlightQuotes.delete(quote.id);
    }
  }

  async createReceiveRequest(
    request: ReceivePaymentRequest,
  ): Promise<ReceivePaymentResponse> {
    if (request.layer === 'onchain') {
      return this.createBitcoinReceiveRequest(request);
    }
    if (request.layer !== 'lightning') {
      throw new Error('This receive method is not available through Satora.');
    }
    if (
      !Number.isSafeInteger(request.amountSats)
      || !request.amountSats
      || request.amountSats <= 0
    ) {
      throw new Error('Enter a valid Lightning amount in sats.');
    }

    const targetAddress = request.targetArkadeAddress ?? await this.wallet.getAddress();
    const created = await this.client.createLightningToArkadeSwap({
      satsReceive: request.amountSats,
      targetAddress,
      invoiceDescription: request.description,
    });
    const sourceAmountSats = wholeSats(
      created.response.source_amount,
      'Lightning invoice amount',
    );
    const targetAmountSats = wholeSats(
      created.response.target_amount,
      'Arkade receive amount',
    );
    if (
      targetAmountSats !== request.amountSats
      || sourceAmountSats < targetAmountSats
      || created.response.target_arkade_address !== targetAddress
    ) {
      throw new Error(
        'The Satora invoice does not match the requested receive details.',
      );
    }
    const invoice = created.response.bolt11_invoice.trim();
    if (!created.response.id.trim() || !invoice) {
      throw new Error('Satora returned an invalid Lightning receive request.');
    }
    const decoded = this.invoiceDecoder(invoice);
    if (
      decoded.amountSats !== sourceAmountSats
      || !Number.isSafeInteger(decoded.expiry)
      || decoded.expiry * 1_000 <= Date.now()
    ) {
      throw new Error('Satora returned an invalid or expired Lightning invoice.');
    }

    const stored = await this.swapStorage.get(created.response.id);
    if (!stored) {
      throw new Error(
        'Satora recovery data was not persisted. The invoice was not exposed.',
      );
    }
    const expiresAt = decoded.expiry * 1_000;
    await this.swapStorage.update(
      created.response.id,
      {
        ...stored.response,
        alice_invoice_expires_at: expiresAt,
      } as unknown as typeof stored.response,
    );

    return {
      request: invoice,
      layer: 'lightning',
      amountSats: targetAmountSats,
      expiresAt,
      paymentId: created.response.id,
      paymentAmountSats: sourceAmountSats,
      feeSats: sourceAmountSats - targetAmountSats,
      provider: this.id,
    };
  }

  private async createBitcoinReceiveRequest(
    request: ReceivePaymentRequest,
  ): Promise<ReceivePaymentResponse> {
    if (
      !Number.isSafeInteger(request.amountSats)
      || !request.amountSats
      || request.amountSats <= 0
    ) {
      throw new Error('Enter a valid Bitcoin amount in sats.');
    }

    const targetAddress = request.targetArkadeAddress ?? await this.wallet.getAddress();
    const created = await this.client.createBitcoinToArkadeSwap({
      satsReceive: request.amountSats,
      targetAddress,
    });
    const sourceAmountSats = wholeSats(
      created.response.source_amount,
      'Bitcoin payment amount',
    );
    const targetAmountSats = wholeSats(
      created.response.target_amount,
      'Arkade receive amount',
    );
    const refundLocktime = wholeSats(
      created.response.btc_refund_locktime,
      'Bitcoin refund locktime',
    );
    const fundingAddress = created.response.btc_htlc_address.trim();
    if (
      targetAmountSats !== request.amountSats
      || sourceAmountSats < targetAmountSats
      || created.response.target_arkade_address !== targetAddress
    ) {
      throw new Error(
        'The Satora Bitcoin request does not match the requested receive details.',
      );
    }
    if (
      !created.response.id.trim()
      || !fundingAddress
      || refundLocktime * 1_000 <= Date.now()
    ) {
      throw new Error('Satora returned an invalid or expired Bitcoin request.');
    }

    const stored = await this.swapStorage.get(created.response.id);
    const storedResponse = stored ? snapshot(stored) : null;
    if (
      !storedResponse
      || storedResponse.direction !== 'btc_to_arkade'
      || storedResponse.btc_htlc_address !== fundingAddress
      || wholeSats(storedResponse.source_amount, 'stored Bitcoin payment amount')
        !== sourceAmountSats
      || wholeSats(storedResponse.target_amount, 'stored Arkade receive amount')
        !== targetAmountSats
      || storedResponse.target_arkade_address !== targetAddress
    ) {
      throw new Error(
        'Satora recovery data was not persisted. The Bitcoin address was not exposed.',
      );
    }

    return {
      request: bitcoinPaymentUri(fundingAddress, sourceAmountSats),
      layer: 'onchain',
      amountSats: targetAmountSats,
      expiresAt: refundLocktime * 1_000,
      paymentId: created.response.id,
      paymentAmountSats: sourceAmountSats,
      feeSats: sourceAmountSats - targetAmountSats,
      provider: this.id,
    };
  }

  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    const current = await this.swapStorage.get(paymentId);
    if (current) await this.refreshStoredSwap(current);
    const latest = await this.swapStorage.get(paymentId);
    return latest ? toSatoraPaymentRecord(latest) : null;
  }

  async listPayments(): Promise<PaymentRecord[]> {
    const records = (await this.swapStorage.getAll())
      .map(toSatoraPaymentRecord)
      .filter((record): record is PaymentRecord => record !== null);
    return records;
  }

  async listSwapRecords(): Promise<PaymentRecord[]> {
    return (await this.swapStorage.getAll()).map(toSatoraSwapRecord);
  }

  async refund(paymentId: string): Promise<PaymentRecord> {
    const stored = await this.swapStorage.get(paymentId);
    if (!stored) throw new Error('Satora payment not found.');
    const current = toSatoraPaymentRecord(stored);
    if (!current || current.status !== 'refundable') {
      throw new Error('This Satora payment is not refundable yet.');
    }

    const storedDirection = snapshot(stored).direction;
    const destinationAddress = storedDirection === 'btc_to_arkade'
      ? await this.wallet.getBoardingAddress()
      : await this.wallet.getAddress();
    const result = await this.client.refundSwap(paymentId, { destinationAddress });
    if (!result.success) throw new Error(result.message);
    const refundTxid = result.txId?.trim();
    if (!refundTxid || result.broadcast === false) {
      throw new Error(
        'Satora did not provide evidence of a broadcast refund transaction. The payment remains refundable.',
      );
    }

    const latest = await this.swapStorage.get(paymentId);
    if (latest) {
      await this.swapStorage.update(
        paymentId,
        {
          ...latest.response,
          alice_refund_txid: refundTxid,
        } as unknown as typeof latest.response,
      );
    }
    await this.client.getSwap(paymentId, { updateStorage: true }).catch(() => null);
    const refreshed = await this.swapStorage.get(paymentId);
    const payment = refreshed ? toSatoraPaymentRecord(refreshed) : null;
    if (!payment) {
      throw new Error(
        'The refund was broadcast but its local recovery record is unavailable. Do not retry the refund until payment status is refreshed.',
      );
    }
    return payment;
  }

  async refresh(): Promise<void> {
    const swaps = await this.swapStorage.getAll();
    await Promise.all(
      swaps
        .filter(stored => snapshot(stored).direction === 'lightning_to_arkade'
          || snapshot(stored).direction === 'btc_to_arkade'
          || hasSatoraFundingEvidence(snapshot(stored)))
        .map(stored => this.refreshStoredSwap(stored)),
    );
  }

  private async refreshStoredSwap(stored: SatoraStoredSwap): Promise<void> {
    await this.client.getSwap(stored.swapId, { updateStorage: true }).catch(() => null);
    const latest = await this.swapStorage.get(stored.swapId);
    if (!latest) return;
    const response = snapshot(latest);
    const status = typeof response.status === 'string' ? response.status : '';
    const claimTxid = typeof response.arkade_claim_txid === 'string'
      ? response.arkade_claim_txid
      : typeof response.alice_claim_txid === 'string'
        ? response.alice_claim_txid
        : '';
    if (
      (
        response.direction !== 'lightning_to_arkade'
        && response.direction !== 'btc_to_arkade'
      )
      || claimTxid
      || !['serverfunded', 'clientredeeming', 'clientredeemed', 'serverredeemed'].includes(status)
      || this.inFlightClaims.has(stored.swapId)
    ) return;

    this.inFlightClaims.add(stored.swapId);
    try {
      const destinationAddress = await this.wallet.getAddress();
      const claim = await this.client.claimArkade(stored.swapId, {
        destinationAddress,
      });
      if (claim.success && claim.txId?.trim()) {
        const claimed = await this.swapStorage.get(stored.swapId);
        if (claimed) {
          await this.swapStorage.update(
            stored.swapId,
            {
              ...claimed.response,
              alice_claim_txid: claim.txId,
            } as unknown as typeof claimed.response,
          );
        }
        await this.client.getSwap(
          stored.swapId,
          { updateStorage: true },
        ).catch(() => null);
      }
    } catch {
      // A server status can arrive before the Arkade indexer sees the VHTLC.
      // Keep the payment pending and retry on the next refresh.
    } finally {
      this.inFlightClaims.delete(stored.swapId);
    }
  }

  async clear(): Promise<void> {
    await this.swapStorage.clear();
    await this.walletStorage.clear();
  }

  async dispose(): Promise<void> {
    this.client.closeSwapStatusSocket();
  }
}
