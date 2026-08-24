import assert from 'node:assert/strict';
import test from 'node:test';
import type { PaymentQuote } from './payment-types.ts';
import {
  absoluteBolt11Expiry,
  SatoraPaymentRail,
  type SatoraClientLike,
} from './satora-rail.ts';
import { bech32 } from '@scure/base';
import {
  createAliceSatoraStorage,
  type SatoraKeyValueStore,
  type SatoraStoredSwap,
} from './satora-storage.ts';

class MemoryKeyValueStore implements SatoraKeyValueStore {
  private readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.values.keys()]);
  }
}

const QUOTE: PaymentQuote = {
  id: 'quote-1',
  provider: 'satora',
  layer: 'lightning',
  request: {
    raw: 'lntb-invoice',
    kind: 'bolt11',
    network: 'mutinynet',
    amountSats: 10_000,
    routes: [
      {
        layer: 'lightning',
        destination: 'lntb-invoice',
        format: 'bolt11',
      },
    ],
  },
  sendAmountSats: 10_001,
  receiveAmountSats: 10_000,
  feeSats: 1,
  expiresAt: Date.now() + 60_000,
  warnings: [],
};

function timestampWords(timestamp: number): number[] {
  const words = Array<number>(7).fill(0);
  let remaining = timestamp;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    words[index] = remaining % 32;
    remaining = Math.floor(remaining / 32);
  }
  return words;
}

test('Satora receive adds the BOLT11 default duration to its encoded timestamp', () => {
  const timestamp = 1_750_000_000;
  const invoice = bech32.encode(
    'lntb10n',
    timestampWords(timestamp),
    5_000,
  );

  assert.equal(absoluteBolt11Expiry(invoice, 3_600), timestamp + 3_600);
  assert.equal(
    absoluteBolt11Expiry(invoice, timestamp + 7_200),
    timestamp + 7_200,
  );
});

function recoverySwap(
  fields: Record<string, unknown> = {},
): SatoraStoredSwap {
  return {
    version: 2,
    swapId: 'swap-1',
    keyIndex: 0,
    response: {
      id: 'swap-1',
      direction: 'arkade_to_lightning',
      status: 'pending',
      source_amount: '10001',
      target_amount: '10000',
      arkade_vhtlc_address: 'tark1funding',
      client_lightning_invoice: 'lntb-invoice',
      ...fields,
    },
    publicKey: 'public',
    preimage: 'preimage',
    preimageHash: 'hash',
    secretKey: 'secret',
    storedAt: Date.now(),
    updatedAt: Date.now(),
  } as SatoraStoredSwap;
}

function setup(options: {
  quote?: PaymentQuote;
  persistOnCreate?: boolean;
  createError?: Error;
  statusAfterRefresh?: string;
  refundResult?: {
    success: boolean;
    message: string;
    txId?: string;
    broadcast?: boolean;
  };
} = {}) {
  const storage = createAliceSatoraStorage(
    'abandon abandon abandon about',
    new MemoryKeyValueStore(),
  );
  let createCalls = 0;
  let sendCalls = 0;
  const client: SatoraClientLike = {
    async createArkadeToLightningSwap() {
      createCalls += 1;
      if (options.createError) throw options.createError;
      if (options.persistOnCreate !== false) {
        await storage.swapStorage.store(recoverySwap());
      }
      return {
        response: {
          id: 'swap-1',
          status: 'pending',
          source_amount: '10001',
          target_amount: '10000',
          arkade_vhtlc_address: 'tark1funding',
          client_lightning_invoice: 'lntb-invoice',
        },
      };
    },
    async createLightningToArkadeSwap() {
      throw new Error('not configured for this test');
    },
    async createBitcoinToArkadeSwap() {
      throw new Error('not configured for this test');
    },
    async getSwap(id) {
      const stored = await storage.swapStorage.get(id);
      if (stored && options.statusAfterRefresh) {
        await storage.swapStorage.update(id, {
          ...stored.response,
          status: options.statusAfterRefresh,
        } as typeof stored.response);
      }
      return {};
    },
    listAllSwaps() {
      return storage.swapStorage.getAll();
    },
    async refundSwap() {
      return options.refundResult
        ?? { success: false, message: 'not refundable' };
    },
    async claimArkade() {
      return { success: false, message: 'not claimable' };
    },
    closeSwapStatusSocket() {},
  };
  const wallet = {
    async send() {
      sendCalls += 1;
      return 'ark-funding-txid';
    },
    async getAddress() {
      return 'tark1refund';
    },
    async getBoardingAddress() {
      return 'tb1qrefund';
    },
  };
  const rail = new SatoraPaymentRail(
    wallet,
    client,
    storage.walletStorage,
    storage.swapStorage,
    async () => options.quote ?? QUOTE,
  );
  return {
    rail,
    storage,
    getCreateCalls: () => createCalls,
    getSendCalls: () => sendCalls,
  };
}

test('Satora rail re-quotes and refuses changed totals before swap creation', async () => {
  const changedQuote = { ...QUOTE, sendAmountSats: 10_002 };
  const context = setup({ quote: changedQuote });

  await assert.rejects(
    context.rail.send(QUOTE),
    /fees changed/,
  );
  assert.equal(context.getCreateCalls(), 0);
  assert.equal(context.getSendCalls(), 0);
});

test('Satora rail refuses funding when recovery data was not persisted', async () => {
  const context = setup({ persistOnCreate: false });

  await assert.rejects(
    context.rail.send(QUOTE),
    /recovery data was not persisted/,
  );
  assert.equal(context.getCreateCalls(), 1);
  assert.equal(context.getSendCalls(), 0);
});

test('Satora provider failure before swap creation cannot fund or persist a payment', async () => {
  const context = setup({ createError: new Error('Satora unavailable: {"detail":"node http://10.0.0.7 down"}') });

  // The SDK's wording, which may carry a server body, is replaced by ours.
  await assert.rejects(context.rail.send(QUOTE), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'SatoraRefusalError');
    assert.equal(error.message, 'SATORA REFUSED THIS PAYMENT. NO FUNDS WERE SENT.');
    assert.ok(!error.message.includes('10.0.0.7'));
    return true;
  });
  assert.equal(context.getCreateCalls(), 1);
  assert.equal(context.getSendCalls(), 0);
  assert.deepEqual(await context.storage.swapStorage.getAll(), []);
});

test('Satora rail funds only after persistence and returns pending network evidence', async () => {
  const context = setup();
  const payment = await context.rail.send(QUOTE);

  assert.equal(context.getCreateCalls(), 1);
  assert.equal(context.getSendCalls(), 1);
  assert.equal(payment.status, 'pending');
  assert.equal(payment.txid, 'ark-funding-txid');
  assert.equal(payment.amountSats, 10_000);
  assert.equal(payment.feeSats, 1);

  const stored = await context.storage.swapStorage.get('swap-1');
  assert.equal(
    (stored?.response as { arkade_fund_txid?: string }).arkade_fund_txid,
    'ark-funding-txid',
  );
});

test('Satora rail refuses a second payment record for the same invoice', async () => {
  const context = setup();
  await context.storage.swapStorage.store(
    recoverySwap({ arkade_fund_txid: 'existing-funding-txid' }),
  );

  await assert.rejects(
    context.rail.send(QUOTE),
    /already has a Satora payment record/,
  );
  assert.equal(context.getCreateCalls(), 0);
  assert.equal(context.getSendCalls(), 0);
});

test('Satora rail still reports pending after funding if the txid cache update fails', async () => {
  const context = setup();
  const originalUpdate = context.storage.swapStorage.update.bind(
    context.storage.swapStorage,
  );
  let updates = 0;
  context.storage.swapStorage.update = async (swapId, response) => {
    updates += 1;
    if (updates === 2) throw new Error('disk full after funding');
    return originalUpdate(swapId, response);
  };

  const payment = await context.rail.send(QUOTE);
  assert.equal(payment.status, 'pending');
  assert.equal(payment.txid, 'ark-funding-txid');
  assert.equal(context.getSendCalls(), 1);
});

test('Satora resumes a funded outgoing swap after storage is reopened', async () => {
  const values = new MemoryKeyValueStore();
  const firstStorage = createAliceSatoraStorage(
    'abandon abandon abandon about',
    values,
  );
  await firstStorage.swapStorage.store(recoverySwap({
    alice_funding_attempted: true,
    arkade_fund_txid: 'ark-funding-txid',
  }));

  const reopened = createAliceSatoraStorage(
    'abandon abandon abandon about',
    values,
  );
  let refreshCalls = 0;
  const client: SatoraClientLike = {
    async createArkadeToLightningSwap() {
      throw new Error('must not create another swap');
    },
    async createLightningToArkadeSwap() {
      throw new Error('not configured for this test');
    },
    async createBitcoinToArkadeSwap() {
      throw new Error('not configured for this test');
    },
    async getSwap(id) {
      refreshCalls += 1;
      const stored = await reopened.swapStorage.get(id);
      assert.ok(stored);
      await reopened.swapStorage.update(id, {
        ...stored.response,
        status: 'serverredeemed',
      } as typeof stored.response);
      return {};
    },
    listAllSwaps() {
      return reopened.swapStorage.getAll();
    },
    async refundSwap() {
      return { success: false, message: 'not refundable' };
    },
    async claimArkade() {
      return { success: false, message: 'not claimable' };
    },
    closeSwapStatusSocket() {},
  };
  const rail = new SatoraPaymentRail(
    {
      async send() {
        throw new Error('must not fund again');
      },
      async getAddress() {
        return 'tark1refund';
      },
      async getBoardingAddress() {
        return 'tb1qrefund';
      },
    },
    client,
    reopened.walletStorage,
    reopened.swapStorage,
  );

  await rail.refresh();
  const [payment] = await rail.listPayments();

  assert.equal(refreshCalls, 1);
  assert.equal(payment?.status, 'settled');
  assert.equal(payment?.txid, 'ark-funding-txid');
});

test('Satora refund stays pending until the provider confirms its terminal status', async () => {
  const context = setup({
    refundResult: {
      success: true,
      message: 'broadcast',
      txId: 'ark-refund-txid',
      broadcast: true,
    },
  });
  await context.storage.swapStorage.store(recoverySwap({
    status: 'serverwontfund',
    alice_funding_attempted: true,
    arkade_fund_txid: 'ark-funding-txid',
  }));

  const payment = await context.rail.refund('swap-1');
  const stored = await context.storage.swapStorage.get('swap-1');

  assert.equal(payment.status, 'pending');
  assert.equal(payment.refundable, false);
  assert.equal(
    (payment.providerData as { refundTxid?: string }).refundTxid,
    'ark-refund-txid',
  );
  assert.equal(stored?.response.status, 'serverwontfund');
  assert.equal(
    (stored?.response as { alice_refund_txid?: string }).alice_refund_txid,
    'ark-refund-txid',
  );
});

test('Satora refund becomes refunded only after provider confirmation', async () => {
  const context = setup({
    statusAfterRefresh: 'clientrefunded',
    refundResult: {
      success: true,
      message: 'broadcast',
      txId: 'ark-refund-txid',
      broadcast: true,
    },
  });
  await context.storage.swapStorage.store(recoverySwap({
    status: 'serverwontfund',
    alice_funding_attempted: true,
    arkade_fund_txid: 'ark-funding-txid',
  }));

  const payment = await context.rail.refund('swap-1');

  assert.equal(payment.status, 'refunded');
  assert.equal(payment.refundable, false);
});

test('Satora refund refuses to claim success without broadcast transaction evidence', async () => {
  const context = setup({
    refundResult: {
      success: true,
      message: 'built but not broadcast',
      broadcast: false,
    },
  });
  await context.storage.swapStorage.store(recoverySwap({
    status: 'serverwontfund',
    alice_funding_attempted: true,
    arkade_fund_txid: 'ark-funding-txid',
  }));

  await assert.rejects(
    context.rail.refund('swap-1'),
    /did not provide evidence of a broadcast refund transaction/,
  );
  const payment = await context.rail.getPayment('swap-1');
  assert.equal(payment?.status, 'refundable');
});

function incomingRecoverySwap(
  fields: Record<string, unknown> = {},
): SatoraStoredSwap {
  return recoverySwap({
    direction: 'lightning_to_arkade',
    source_amount: '10001',
    target_amount: '10000',
    target_arkade_address: 'tark1receive',
    bolt11_invoice: 'lntb-receive-invoice',
    ...fields,
  });
}

function setupReceive(options: {
  persistOnCreate?: boolean;
  statusAfterRefresh?: string;
  claimTxid?: string;
  invoiceExpiry?: number;
} = {}) {
  const storage = createAliceSatoraStorage(
    'abandon abandon abandon about',
    new MemoryKeyValueStore(),
  );
  let createCalls = 0;
  let claimCalls = 0;
  const client: SatoraClientLike = {
    async createArkadeToLightningSwap() {
      throw new Error('not configured for this test');
    },
    async createLightningToArkadeSwap() {
      createCalls += 1;
      if (options.persistOnCreate !== false) {
        await storage.swapStorage.store(incomingRecoverySwap());
      }
      return {
        response: {
          id: 'swap-1',
          status: 'pending',
          source_amount: '10001',
          target_amount: '10000',
          arkade_vhtlc_address: 'tark1vhtlc',
          target_arkade_address: 'tark1receive',
          bolt11_invoice: 'lntb-receive-invoice',
        },
      };
    },
    async createBitcoinToArkadeSwap() {
      throw new Error('not configured for this test');
    },
    async getSwap(id) {
      const stored = await storage.swapStorage.get(id);
      if (stored && options.statusAfterRefresh) {
        await storage.swapStorage.update(id, {
          ...stored.response,
          status: options.statusAfterRefresh,
        } as typeof stored.response);
      }
      return {};
    },
    listAllSwaps() {
      return storage.swapStorage.getAll();
    },
    async refundSwap() {
      return { success: false, message: 'not refundable' };
    },
    async claimArkade() {
      claimCalls += 1;
      return options.claimTxid
        ? { success: true, message: 'claimed', txId: options.claimTxid }
        : { success: false, message: 'not funded yet' };
    },
    closeSwapStatusSocket() {},
  };
  const wallet = {
    async send() {
      throw new Error('receive must not send');
    },
    async getAddress() {
      return 'tark1receive';
    },
    async getBoardingAddress() {
      return 'tb1qrefund';
    },
  };
  const rail = new SatoraPaymentRail(
    wallet,
    client,
    storage.walletStorage,
    storage.swapStorage,
    async () => QUOTE,
    () => ({
      amountSats: 10_001,
      expiry: options.invoiceExpiry
        ?? Math.floor(Date.now() / 1_000) + 3_600,
    }),
  );
  return {
    rail,
    storage,
    getCreateCalls: () => createCalls,
    getClaimCalls: () => claimCalls,
  };
}

test('Satora receive exposes an invoice only after recovery data is persisted', async () => {
  const context = setupReceive();
  const receive = await context.rail.createReceiveRequest({
    layer: 'lightning',
    amountSats: 10_000,
    description: 'Alice Bitcoin payment',
  });

  assert.equal(context.getCreateCalls(), 1);
  assert.equal(receive.request, 'lntb-receive-invoice');
  assert.equal(receive.amountSats, 10_000);
  assert.equal(receive.paymentId, 'swap-1');
  assert.ok(receive.expiresAt && receive.expiresAt > Date.now());
});

test('Satora receive hides an invoice when recovery data was not persisted', async () => {
  const context = setupReceive({ persistOnCreate: false });

  await assert.rejects(
    context.rail.createReceiveRequest({
      layer: 'lightning',
      amountSats: 10_000,
    }),
    /recovery data was not persisted/,
  );
});

test('Satora receive never exposes an invoice that is already expired', async () => {
  const context = setupReceive({
    invoiceExpiry: Math.floor(Date.now() / 1_000) - 1,
  });

  await assert.rejects(
    context.rail.createReceiveRequest({
      layer: 'lightning',
      amountSats: 10_000,
    }),
    /invalid or expired Lightning invoice/,
  );
  assert.deepEqual(await context.rail.listPayments(), []);
});

test('Satora receive stays pending until an Arkade claim txid exists', async () => {
  const context = setupReceive({ statusAfterRefresh: 'serverfunded' });
  await context.storage.swapStorage.store(incomingRecoverySwap());

  await context.rail.refresh();
  const payment = await context.rail.getPayment('swap-1');

  assert.equal(context.getClaimCalls() >= 1, true);
  assert.equal(payment?.direction, 'incoming');
  assert.equal(payment?.status, 'pending');
  assert.equal(payment?.txid, undefined);
});

test('Satora receive settles only after the SDK returns an Arkade claim txid', async () => {
  const context = setupReceive({
    statusAfterRefresh: 'serverfunded',
    claimTxid: 'arkade-claim-txid',
  });
  await context.storage.swapStorage.store(incomingRecoverySwap());

  await context.rail.refresh();
  const payment = await context.rail.getPayment('swap-1');

  assert.equal(context.getClaimCalls(), 1);
  assert.equal(payment?.status, 'settled');
  assert.equal(payment?.txid, 'arkade-claim-txid');
  assert.equal(payment?.amountSats, 10_000);
  assert.equal(payment?.feeSats, 1);
});

function bitcoinRecoverySwap(
  fields: Record<string, unknown> = {},
): SatoraStoredSwap {
  return recoverySwap({
    direction: 'btc_to_arkade',
    source_amount: '10210',
    target_amount: '10000',
    btc_htlc_address: 'tb1qswap',
    btc_refund_locktime: Math.floor(Date.now() / 1_000) + 7_200,
    target_arkade_address: 'tark1receive',
    ...fields,
  });
}

function setupBitcoinReceive(options: {
  persistOnCreate?: boolean;
  storedFundingAddress?: string;
  claimTxid?: string;
  refundResult?: {
    success: boolean;
    message: string;
    txId?: string;
    broadcast?: boolean;
  };
} = {}) {
  const storage = createAliceSatoraStorage(
    'abandon abandon abandon about',
    new MemoryKeyValueStore(),
  );
  let createCalls = 0;
  let claimCalls = 0;
  let refundDestination: string | null = null;
  const refundLocktime = Math.floor(Date.now() / 1_000) + 7_200;
  const client: SatoraClientLike = {
    async createArkadeToLightningSwap() {
      throw new Error('not configured for this test');
    },
    async createLightningToArkadeSwap() {
      throw new Error('not configured for this test');
    },
    async createBitcoinToArkadeSwap() {
      createCalls += 1;
      if (options.persistOnCreate !== false) {
        await storage.swapStorage.store(bitcoinRecoverySwap({
          btc_htlc_address: options.storedFundingAddress ?? 'tb1qswap',
          btc_refund_locktime: refundLocktime,
        }));
      }
      return {
        response: {
          id: 'swap-1',
          status: 'pending',
          source_amount: '10210',
          target_amount: '10000',
          btc_htlc_address: 'tb1qswap',
          btc_refund_locktime: refundLocktime,
          target_arkade_address: 'tark1receive',
        },
      };
    },
    async getSwap() {
      return {};
    },
    listAllSwaps() {
      return storage.swapStorage.getAll();
    },
    async refundSwap(_id, request) {
      refundDestination = request.destinationAddress;
      return options.refundResult
        ?? { success: false, message: 'not refundable' };
    },
    async claimArkade() {
      claimCalls += 1;
      return options.claimTxid
        ? { success: true, message: 'claimed', txId: options.claimTxid }
        : { success: false, message: 'not funded yet' };
    },
    closeSwapStatusSocket() {},
  };
  const rail = new SatoraPaymentRail(
    {
      async send() {
        throw new Error('receive must not send');
      },
      async getAddress() {
        return 'tark1receive';
      },
      async getBoardingAddress() {
        return 'tb1qaliceboarding';
      },
    },
    client,
    storage.walletStorage,
    storage.swapStorage,
  );
  return {
    rail,
    storage,
    getCreateCalls: () => createCalls,
    getClaimCalls: () => claimCalls,
    getRefundDestination: () => refundDestination,
  };
}

test('Satora Bitcoin receive exposes the exact funded amount only after persistence', async () => {
  const context = setupBitcoinReceive();
  const receive = await context.rail.createReceiveRequest({
    layer: 'onchain',
    amountSats: 10_000,
  });

  assert.equal(context.getCreateCalls(), 1);
  assert.equal(receive.request, 'bitcoin:tb1qswap?amount=0.0001021');
  assert.equal(receive.amountSats, 10_000);
  assert.equal(receive.paymentAmountSats, 10_210);
  assert.equal(receive.feeSats, 210);
  assert.equal(receive.provider, 'satora');
  assert.equal(receive.paymentId, 'swap-1');
  assert.ok(receive.expiresAt && receive.expiresAt > Date.now());
});

test('Satora Bitcoin receive hides the address without matching recovery data', async () => {
  const missing = setupBitcoinReceive({ persistOnCreate: false });
  await assert.rejects(
    missing.rail.createReceiveRequest({
      layer: 'onchain',
      amountSats: 10_000,
    }),
    /address was not exposed/,
  );

  const mismatched = setupBitcoinReceive({
    storedFundingAddress: 'tb1qtampered',
  });
  await assert.rejects(
    mismatched.rail.createReceiveRequest({
      layer: 'onchain',
      amountSats: 10_000,
    }),
    /address was not exposed/,
  );
});

test('Satora Bitcoin receive stays pending until the Arkade claim has a txid', async () => {
  const context = setupBitcoinReceive();
  await context.storage.swapStorage.store(bitcoinRecoverySwap({
    status: 'serverfunded',
    btc_fund_txid: 'bitcoin-funding-txid',
    arkade_fund_txid: 'arkade-funding-txid',
  }));

  await context.rail.refresh();
  const payment = await context.rail.getPayment('swap-1');

  assert.equal(context.getClaimCalls() >= 1, true);
  assert.equal(payment?.status, 'pending');
  assert.equal(payment?.txid, 'bitcoin-funding-txid');
});

test('Satora Bitcoin receive settles only with Arkade claim transaction evidence', async () => {
  const context = setupBitcoinReceive({ claimTxid: 'arkade-claim-txid' });
  await context.storage.swapStorage.store(bitcoinRecoverySwap({
    status: 'serverfunded',
    btc_fund_txid: 'bitcoin-funding-txid',
    arkade_fund_txid: 'arkade-funding-txid',
  }));

  await context.rail.refresh();
  const payment = await context.rail.getPayment('swap-1');
  const data = payment?.providerData as { completionTxid?: string };

  assert.equal(payment?.status, 'settled');
  assert.equal(payment?.txid, 'bitcoin-funding-txid');
  assert.equal(data.completionTxid, 'arkade-claim-txid');
});

test('Satora Bitcoin refund targets Alice boarding and waits for provider confirmation', async () => {
  const context = setupBitcoinReceive({
    refundResult: {
      success: true,
      message: 'broadcast',
      txId: 'bitcoin-refund-txid',
      broadcast: true,
    },
  });
  await context.storage.swapStorage.store(bitcoinRecoverySwap({
    status: 'serverwontfund',
    btc_fund_txid: 'bitcoin-funding-txid',
  }));

  const payment = await context.rail.refund('swap-1');

  assert.equal(context.getRefundDestination(), 'tb1qaliceboarding');
  assert.equal(payment.status, 'pending');
  assert.equal(payment.refundable, false);
});
