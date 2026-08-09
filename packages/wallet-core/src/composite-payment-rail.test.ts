import assert from 'node:assert/strict';
import test from 'node:test';
import { CompositePaymentRail } from './composite-payment-rail.ts';
import type { PaymentRail } from './payment-rail.ts';

function rail(id: string, layers: PaymentRail['supportedLayers']) {
  let receiveCalls = 0;
  const value: PaymentRail = {
    id,
    supportedLayers: layers,
    canHandle: () => false,
    quote: async () => { throw new Error('unused'); },
    send: async () => { throw new Error('unused'); },
    async createReceiveRequest(request) {
      receiveCalls += 1;
      return {
        request: `${id}-invoice`,
        layer: request.layer,
        amountSats: request.amountSats,
        expiresAt: null,
      };
    },
    getPayment: async () => null,
    listPayments: async () => [],
    refund: async () => { throw new Error('unused'); },
    refresh: async () => {},
    clear: async () => {},
    dispose: async () => {},
  };
  return { value, calls: () => receiveCalls };
}

test('composite rail sends Lightning receive to the Satora primary', async () => {
  const primary = rail('satora', ['lightning']);
  const fallback = rail('boltz', ['onchain', 'lightning']);
  const composite = new CompositePaymentRail(primary.value, fallback.value);

  const response = await composite.createReceiveRequest({
    layer: 'lightning',
    amountSats: 10_000,
  });

  assert.equal(response.request, 'satora-invoice');
  assert.equal(primary.calls(), 1);
  assert.equal(fallback.calls(), 0);
});

test('composite rail sends Bitcoin receive to the Satora primary', async () => {
  const primary = rail('satora', ['onchain', 'lightning']);
  const fallback = rail('boltz', ['onchain', 'lightning']);
  const composite = new CompositePaymentRail(primary.value, fallback.value);

  const response = await composite.createReceiveRequest({
    layer: 'onchain',
    amountSats: 10_000,
  });

  assert.equal(response.request, 'satora-invoice');
  assert.equal(primary.calls(), 1);
  assert.equal(fallback.calls(), 0);
});
