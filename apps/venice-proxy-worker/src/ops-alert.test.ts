import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Env } from './index.ts';
import { canCreateInvoice, diagnoseBtcpay } from './ops-alert.ts';

const env = {
  BTCPAY_BASE_URL: 'https://btcpay.test',
  BTCPAY_STORE_ID: 'store-alice',
  BTCPAY_API_KEY: 'key',
} as unknown as Env;

const originalFetch = globalThis.fetch;

/** Answers the health probe with 200 and the key probe with the given reply. */
function stubBtcpay(key: { status: number; body?: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/health')) return new Response('{"synchronized":true}', { status: 200 });
    if (url.endsWith('/api/v1/api-keys/current')) {
      return new Response(key.body === undefined ? '' : JSON.stringify(key.body), { status: key.status });
    }
    throw new Error(`unexpected probe ${url}`);
  }) as typeof fetch;
}

afterEach(() => { globalThis.fetch = originalFetch; });

describe('canCreateInvoice', () => {
  it('accepts the permission unscoped, scoped to the store, or implied by a wider one', () => {
    assert.equal(canCreateInvoice(['btcpay.store.cancreateinvoice'], 'store-alice'), true);
    assert.equal(canCreateInvoice(['btcpay.store.cancreateinvoice:store-alice'], 'store-alice'), true);
    assert.equal(canCreateInvoice(['btcpay.store.canmodifystoresettings'], 'store-alice'), true);
    assert.equal(canCreateInvoice(['btcpay.server.canmodifyserversettings'], 'store-alice'), true);
  });

  it('refuses a key scoped to another store or holding only other rights', () => {
    assert.equal(canCreateInvoice(['btcpay.store.cancreateinvoice:store-other'], 'store-alice'), false);
    assert.equal(canCreateInvoice(['btcpay.store.canviewinvoices'], 'store-alice'), false);
    assert.equal(canCreateInvoice([], 'store-alice'), false);
  });
});

describe('diagnoseBtcpay', () => {
  it('is healthy with a key that can only create invoices, which is all checkout needs', async () => {
    stubBtcpay({ status: 200, body: { permissions: ['btcpay.store.cancreateinvoice:store-alice'] } });
    const diagnosis = await diagnoseBtcpay(env);
    assert.equal(diagnosis.reachable, true);
  });

  it('reports a refused key', async () => {
    stubBtcpay({ status: 401 });
    const diagnosis = await diagnoseBtcpay(env);
    assert.equal(diagnosis.reachable, false);
    assert.match(diagnosis.detail, /API key is refused/);
  });

  it('reports a valid key that cannot create invoices on this store', async () => {
    stubBtcpay({ status: 200, body: { permissions: ['btcpay.store.canviewinvoices:store-alice'] } });
    const diagnosis = await diagnoseBtcpay(env);
    assert.equal(diagnosis.reachable, false);
    assert.match(diagnosis.detail, /cannot create invoices/);
  });
});
