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
    source_amount_sats: 10_001,
    target_amount_sats: 10_000,
    protocol_fee_sats: 1,
    network_fee_sats: 0,
    protocol_fee_rate: 0.0001,
    min_amount_sats: 1_000,
    max_amount_sats: 1_000_000,
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
  assert.equal(url.pathname, '/quote/lightning-send');
  assert.equal(url.searchParams.get('lightning_invoice'), 'lntb-test-invoice');
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
      fetcher: async () => quoteResponse({ target_amount_sats: 9_999 }),
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
          target_amount_sats: 500,
          source_amount_sats: 501,
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

test('Satora quote surfaces the reason Satora gives for refusing', async () => {
  await assert.rejects(
    quoteArkToLightningWithSatora(REQUEST, undefined, {
      baseUrl: 'https://satora.test',
      fetcher: async () => Response.json(
        { error: 'invoice timeout too long; use an invoice that expires within 24h' },
        { status: 400 },
      ),
    }),
    /SATORA ONLY PAYS LIGHTNING INVOICES THAT EXPIRE WITHIN 24 HOURS/,
  );
});

test('Satora quote never shows an unknown server reason to the user', async () => {
  await assert.rejects(
    quoteArkToLightningWithSatora(REQUEST, undefined, {
      baseUrl: 'https://satora.test',
      fetcher: async () => Response.json(
        { error: 'upstream failure at http://10.0.0.7:9735/internal/pay: stack trace follows' },
        { status: 502 },
      ),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'SATORA REFUSED THIS PAYMENT (HTTP 502). NO FUNDS WERE SENT.');
      assert.ok(!error.message.includes('10.0.0.7'));
      return true;
    },
  );
});
