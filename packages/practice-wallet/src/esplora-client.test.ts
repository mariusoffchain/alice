import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PracticeEsploraClient,
  summarizePracticeHistory,
  type EsploraAddressTx,
} from './esplora-client.ts';

type FakeCall = { url: string; init?: RequestInit };

function fakeFetch(
  responder: (url: string, init?: RequestInit) => { status?: number; body: string },
): { calls: FakeCall[]; fetch: (url: string, init?: RequestInit) => Promise<Response> } {
  const calls: FakeCall[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      const { status = 200, body } = responder(url, init);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body),
        json: () => Promise.resolve(JSON.parse(body)),
      } as Response);
    },
  };
}

test('maps address UTXOs from the Esplora shape', async () => {
  const { fetch, calls } = fakeFetch(() => ({
    body: JSON.stringify([
      { txid: 'ab'.repeat(32), vout: 1, value: 5000, status: { confirmed: true } },
      { txid: 'cd'.repeat(32), vout: 0, value: 700, status: { confirmed: false } },
    ]),
  }));
  const client = new PracticeEsploraClient('https://example.test/api/', fetch);
  const utxos = await client.getAddressUtxos('tb1qexample');
  assert.equal(calls[0].url, 'https://example.test/api/address/tb1qexample/utxo');
  assert.deepEqual(utxos, [
    { txid: 'ab'.repeat(32), vout: 1, valueSats: 5000, confirmed: true },
    { txid: 'cd'.repeat(32), vout: 0, valueSats: 700, confirmed: false },
  ]);
});

test('broadcasts raw transactions with POST and returns the txid', async () => {
  const txid = 'ef'.repeat(32);
  const { fetch, calls } = fakeFetch(() => ({ body: `${txid}\n` }));
  const client = new PracticeEsploraClient('https://example.test/api', fetch);
  assert.equal(await client.broadcastTx('0200aabb'), txid);
  assert.equal(calls[0].url, 'https://example.test/api/tx');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(calls[0].init?.body, '0200aabb');
});

test('surfaces explorer errors with status and detail', async () => {
  const { fetch } = fakeFetch(() => ({
    status: 400,
    body: 'sendrawtransaction RPC error: min relay fee not met',
  }));
  const client = new PracticeEsploraClient('https://example.test/api', fetch);
  await assert.rejects(
    () => client.broadcastTx('0200'),
    /failed \(400\).*min relay fee not met/,
  );
});

test('recommendedFeeRate rounds up and falls back across targets', async () => {
  const { fetch } = fakeFetch(() => ({ body: JSON.stringify({ '6': 1.3 }) }));
  const client = new PracticeEsploraClient('https://example.test/api', fetch);
  assert.equal(await client.recommendedFeeRate(2), 2);

  const empty = new PracticeEsploraClient(
    'https://example.test/api',
    fakeFetch(() => ({ body: '{}' })).fetch,
  );
  assert.equal(await empty.recommendedFeeRate(2), 1);
});

test('getTipHeight rejects non-numeric bodies', async () => {
  const { fetch } = fakeFetch(() => ({ body: '<html>gateway error</html>' }));
  const client = new PracticeEsploraClient('https://example.test/api', fetch);
  await assert.rejects(() => client.getTipHeight(), /invalid tip height/);
});

test('summarizePracticeHistory nets amounts from the wallet point of view', () => {
  const owned = new Set(['tb1qmine', 'tb1qchange']);
  const txs: EsploraAddressTx[] = [
    {
      txid: 'aa'.repeat(32),
      fee: 141,
      status: { confirmed: true, block_time: 1_755_000_000 },
      vin: [{ prevout: { scriptpubkey_address: 'tb1qother', value: 50_000 } }],
      vout: [
        { scriptpubkey_address: 'tb1qmine', value: 30_000 },
        { scriptpubkey_address: 'tb1qother', value: 19_859 },
      ],
    },
    {
      txid: 'bb'.repeat(32),
      fee: 141,
      status: { confirmed: false },
      vin: [{ prevout: { scriptpubkey_address: 'tb1qmine', value: 30_000 } }],
      vout: [
        { scriptpubkey_address: 'tb1qpeer', value: 10_000 },
        { scriptpubkey_address: 'tb1qchange', value: 19_859 },
      ],
    },
    // Duplicate txid must be ignored.
    {
      txid: 'aa'.repeat(32),
      fee: 141,
      status: { confirmed: true },
      vin: [],
      vout: [{ scriptpubkey_address: 'tb1qmine', value: 30_000 }],
    },
  ];
  const entries = summarizePracticeHistory(txs, owned);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    txid: 'aa'.repeat(32),
    direction: 'incoming',
    amountSats: 30_000,
    feeSats: 141,
    confirmed: true,
    blockTime: 1_755_000_000,
  });
  // Outgoing net effect includes the fee: 30000 in, 19859 back as change.
  assert.deepEqual(entries[1], {
    txid: 'bb'.repeat(32),
    direction: 'outgoing',
    amountSats: 10_141,
    feeSats: 141,
    confirmed: false,
    blockTime: null,
  });
});
