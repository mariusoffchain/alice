import assert from 'node:assert/strict';
import test from 'node:test';
import { ArkError, type FeeInfo } from '@arkade-os/sdk';
import {
  NativeOnchainPayment,
  canOfferNativeOnchainFallback,
} from './native-onchain.ts';
import type { ParsedPaymentRequest } from './payment-types.ts';

const BITCOIN_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const ARKADE_ADDRESS = 'ark1qtest';

const REQUEST: ParsedPaymentRequest = {
  raw: BITCOIN_ADDRESS,
  kind: 'bitcoin-address',
  network: 'mutinynet',
  amountSats: null,
  routes: [{ layer: 'onchain', destination: BITCOIN_ADDRESS }],
};

function feeInfo(inputFee = 2, outputFee = 10): FeeInfo {
  return {
    intentFee: {
      offchainInput: `${inputFee}.0`,
      onchainOutput: `${outputFee}.0`,
    },
    txFeeRate: '1',
  };
}

type FakeVtxo = {
  txid: string;
  vout: number;
  value: number;
  createdAt: Date;
  script: string;
  status: { confirmed: boolean };
  isUnrolled: boolean;
  virtualStatus: {
    state: 'preconfirmed' | 'settled' | 'swept' | 'spent';
    batchExpiry?: number;
  };
};

const DEFAULT_VTXOS: FakeVtxo[] = [
  {
    txid: '11'.repeat(32),
    vout: 0,
    value: 2_000,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    script: '00',
    status: { confirmed: true },
    isUnrolled: false,
    virtualStatus: { state: 'settled' as const, batchExpiry: undefined },
  },
  {
    txid: '22'.repeat(32),
    vout: 1,
    value: 3_000,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    script: '00',
    status: { confirmed: true },
    isUnrolled: false,
    virtualStatus: { state: 'settled' as const, batchExpiry: undefined },
  },
];

function fakeWallet(
  fees: FeeInfo | FeeInfo[],
  options: {
    vtxos?: typeof DEFAULT_VTXOS;
    settleErrors?: Error[];
  } = {},
) {
  const settlements: Array<{
    inputs: unknown[];
    outputs: Array<{ address: string; amount: bigint }>;
  }> = [];
  const settleErrors = [...(options.settleErrors ?? [])];
  let infoCalls = 0;
  const feeSequence = Array.isArray(fees) ? fees : [fees];
  const wallet = {
    dustAmount: 330n,
    arkProvider: {
      async getInfo() {
        const selected = feeSequence[Math.min(infoCalls, feeSequence.length - 1)];
        infoCalls += 1;
        return {
          dust: 330n,
          fees: selected,
        };
      },
    },
    async getVtxos() {
      return options.vtxos ?? DEFAULT_VTXOS;
    },
    async getAddress() {
      return ARKADE_ADDRESS;
    },
    async settle(params: {
      inputs: unknown[];
      outputs: Array<{ address: string; amount: bigint }>;
    }) {
      settlements.push(params);
      const error = settleErrors.shift();
      if (error) throw error;
      return 'arkade-settlement-txid';
    },
  };
  return { wallet: wallet as any, settlements, getInfoCalls: () => infoCalls };
}

test('native exit quote exposes exact recipient amount and all Arkade fees', async () => {
  const context = fakeWallet(feeInfo());
  const payment = new NativeOnchainPayment(context.wallet);

  const quote = await payment.quote(REQUEST, 1_000);

  assert.equal(quote.provider, 'arkade-native');
  assert.equal(quote.receiveAmountSats, 1_000);
  assert.equal(quote.feeSats, 12);
  assert.equal(quote.sendAmountSats, 1_012);
  assert.deepEqual(
    (quote.providerData as { selectedOutpoints: string[] }).selectedOutpoints,
    [`${'11'.repeat(32)}:0`],
  );
  assert.equal(context.settlements.length, 0);
});

test('native exit stays pending and only submits the confirmed destination once', async () => {
  const context = fakeWallet(feeInfo());
  const payment = new NativeOnchainPayment(context.wallet);
  const quote = await payment.quote(REQUEST, 1_000);

  const record = await payment.send(quote);

  assert.equal(record.status, 'pending');
  assert.equal(record.provider, 'arkade-native');
  assert.equal(record.amountSats, 1_000);
  assert.equal(record.txid, 'arkade-settlement-txid');
  assert.equal(context.settlements.length, 1);
  assert.equal(context.settlements[0]?.inputs.length, 1);
  assert.deepEqual(context.settlements[0]?.outputs, [
    { address: BITCOIN_ADDRESS, amount: 1_000n },
    { address: ARKADE_ADDRESS, amount: 988n },
  ]);

  await assert.rejects(
    payment.send(quote),
    /already being processed/,
  );
  assert.equal(context.settlements.length, 1);
});

test('native exit excludes non-cooperative VTXOs before quoting', async () => {
  const context = fakeWallet(feeInfo(), {
    vtxos: [
      {
        ...DEFAULT_VTXOS[0],
        value: 1_500,
        virtualStatus: { state: 'swept' as const, batchExpiry: Date.now() - 1_000 },
      },
      DEFAULT_VTXOS[1],
    ],
  });
  const payment = new NativeOnchainPayment(context.wallet);

  const quote = await payment.quote(REQUEST, 1_000);
  const record = await payment.send(quote);

  assert.equal(record.txid, 'arkade-settlement-txid');
  assert.equal(context.settlements.length, 1);
  assert.equal(
    (context.settlements[0]?.inputs[0] as { txid: string }).txid,
    '22'.repeat(32),
  );
});

test('native exit excludes the exact INVALID_PSBT_INPUT before requiring a new quote', async () => {
  const rejectedOutpoint = `${'11'.repeat(32)}:0`;
  const context = fakeWallet(feeInfo(), {
    settleErrors: [
      new ArkError(
        3,
        `INVALID_PSBT_INPUT (5): vtxo ${rejectedOutpoint} expires after tomorrow`,
        'INVALID_PSBT_INPUT',
        // arkd reports the VTXO's vout here, not its position in Alice's input array.
        { input_index: '1' },
      ),
    ],
  });
  const payment = new NativeOnchainPayment(context.wallet);
  const rejectedQuote = await payment.quote(REQUEST, 1_000);

  await assert.rejects(
    payment.send(rejectedQuote),
    /not eligible.*excluded it.*new quote/i,
  );
  assert.equal(context.settlements.length, 1);

  const replacementQuote = await payment.quote(REQUEST, 1_000);
  assert.deepEqual(
    (replacementQuote.providerData as { selectedOutpoints: string[] }).selectedOutpoints,
    [`${'22'.repeat(32)}:1`],
  );

  const record = await payment.send(replacementQuote);
  assert.equal(record.txid, 'arkade-settlement-txid');
  assert.equal(context.settlements.length, 2);
  assert.equal(
    (context.settlements[1]?.inputs[0] as { txid: string }).txid,
    '22'.repeat(32),
  );
});

test('native exit prioritizes the VTXO closest to expiry on mainnet-style settlements', async () => {
  const context = fakeWallet(feeInfo(), {
    vtxos: [
      {
        ...DEFAULT_VTXOS[0],
        value: 1_500,
        virtualStatus: {
          state: 'settled',
          batchExpiry: Date.now() + 30 * 24 * 60 * 60 * 1_000,
        },
      },
      {
        ...DEFAULT_VTXOS[1],
        value: 3_000,
        virtualStatus: {
          state: 'settled',
          batchExpiry: Date.now() + 24 * 60 * 60 * 1_000,
        },
      },
    ],
  });
  const payment = new NativeOnchainPayment(context.wallet);

  const quote = await payment.quote(REQUEST, 1_000);

  assert.deepEqual(
    (quote.providerData as { selectedOutpoints: string[] }).selectedOutpoints,
    [`${'22'.repeat(32)}:1`],
  );
});

test('native exit does not exclude a guessed input when Arkade omits the rejected outpoint', async () => {
  const context = fakeWallet(feeInfo(), {
    settleErrors: [
      new ArkError(
        3,
        'INVALID_PSBT_INPUT (5): missing taproot leaf script',
        'INVALID_PSBT_INPUT',
        { input_index: '0' },
      ),
    ],
  });
  const payment = new NativeOnchainPayment(context.wallet);
  const quote = await payment.quote(REQUEST, 1_000);

  await assert.rejects(payment.send(quote), /missing taproot leaf script/);

  const nextQuote = await payment.quote(REQUEST, 1_000);
  assert.deepEqual(
    (nextQuote.providerData as { selectedOutpoints: string[] }).selectedOutpoints,
    [`${'11'.repeat(32)}:0`],
  );
});

test('native exit fails closed when Arkade fees change after confirmation', async () => {
  const context = fakeWallet([feeInfo(2, 10), feeInfo(2, 20)]);
  const payment = new NativeOnchainPayment(context.wallet);
  const quote = await payment.quote(REQUEST, 1_000);

  await assert.rejects(
    payment.send(quote),
    /fees changed/,
  );
  assert.equal(context.settlements.length, 0);
});

test('native exit rejects a destination changed after confirmation', async () => {
  const context = fakeWallet(feeInfo());
  const payment = new NativeOnchainPayment(context.wallet);
  const quote = await payment.quote(REQUEST, 1_000);
  quote.request = {
    ...quote.request,
    routes: [{
      layer: 'onchain',
      destination: 'tb1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssk79hv2',
    }],
  };

  await assert.rejects(
    payment.send(quote),
    /destination changed/,
  );
  assert.equal(context.settlements.length, 0);
});

test('Boltz fallback policy only permits native exit before swap creation and funding', () => {
  assert.equal(canOfferNativeOnchainFallback({
    swapCreated: false,
    fundingAttempted: false,
  }), true);
  assert.equal(canOfferNativeOnchainFallback({
    swapCreated: true,
    fundingAttempted: false,
  }), false);
  assert.equal(canOfferNativeOnchainFallback({
    swapCreated: true,
    fundingAttempted: true,
  }), false);
  assert.equal(canOfferNativeOnchainFallback({
    swapCreated: false,
    fundingAttempted: true,
  }), false);
});
