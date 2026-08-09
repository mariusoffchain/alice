import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParsedPaymentRequest } from './payment-types.ts';
import { quoteArkToLightningWithSatora } from './satora-quote.ts';

const REQUEST: ParsedPaymentRequest = {
  raw: 'lntb-test-invoice',
  kind: 'bolt11',
  network: 'mutinynet',
  amountSats: 10_000,
  routes: [
    {
      layer: 'lightning',
      destination: 'lntb-test-invoice',
      format: 'bolt11',
    },
  ],
};

function quoteResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    exchange_rate: '1.0',
    network_fee: 0,
    gasless_network_fee: 0,
    protocol_fee: 1,
    protocol_fee_rate: 0.0001,
    min_amount: 1_000,
    max_amount: 1_000_000,
    source_amount: '10000',
    target_amount: '10000',
    net_source_amount: '10001',
    net_target_amount: '10000',
    ...overrides,
  });
}

test('Satora quote requests the exact Lightning target and maps the net source total', async () => {
  let requestedUrl = '';
  let requestedMethod = '';
  const quote = await quoteArkToLightningWithSatora(REQUEST, undefined, {
    baseUrl: 'https://satora.test/',
    now: () => 1_000,
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? '';
      return quoteResponse();
    },
  });

  const url = new URL(requestedUrl);
  assert.equal(requestedMethod, 'GET');
  assert.equal(url.pathname, '/quote');
  assert.equal(url.searchParams.get('source_chain'), 'Arkade');
  assert.equal(url.searchParams.get('target_chain'), 'Lightning');
  assert.equal(url.searchParams.get('target_amount'), '10000');
  assert.equal(quote.provider, 'satora');
  assert.equal(quote.receiveAmountSats, 10_000);
  assert.equal(quote.sendAmountSats, 10_001);
  assert.equal(quote.feeSats, 1);
  assert.equal(quote.expiresAt, 61_000);
});

test('Satora quote rejects a response that does not fully cover the invoice', async () => {
  await assert.rejects(
    quoteArkToLightningWithSatora(REQUEST, undefined, {
      baseUrl: 'https://satora.test',
      fetcher: async () => quoteResponse({ net_target_amount: '9999' }),
    }),
    /does not fully cover the Lightning invoice/,
  );
});

test('Satora quote fails closed on a malformed provider response', async () => {
  await assert.rejects(
    quoteArkToLightningWithSatora(REQUEST, undefined, {
      baseUrl: 'https://satora.test',
      fetcher: async () => Response.json(null),
    }),
    /returned an unreadable quote/,
  );
});

test('Satora quote enforces the provider limits before exposing confirmation details', async () => {
  await assert.rejects(
    quoteArkToLightningWithSatora(
      { ...REQUEST, amountSats: 500 },
      undefined,
      {
        baseUrl: 'https://satora.test',
        fetcher: async () => quoteResponse({
          target_amount: '500',
          net_target_amount: '500',
          net_source_amount: '501',
        }),
      },
    ),
    /Satora Lightning minimum: 1,000 sats/,
  );
});

test('Satora quote refuses payment requests for the wrong configured network', async () => {
  let fetchCalled = false;
  await assert.rejects(
    quoteArkToLightningWithSatora(
      { ...REQUEST, network: 'bitcoin' },
      undefined,
      {
        baseUrl: 'https://satora.test',
        fetcher: async () => {
          fetchCalled = true;
          return quoteResponse();
        },
      },
    ),
    /not for Mutinynet/,
  );
  assert.equal(fetchCalled, false);
});
