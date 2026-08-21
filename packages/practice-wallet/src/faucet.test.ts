import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestPracticeFaucet } from './faucet.ts';

function fakeFetch(status: number, body: string) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    } as Response);
  };
  return { calls, fetchImpl };
}

test('posts the request and returns the faucet txid', async () => {
  const txid = 'ab'.repeat(32);
  const { calls, fetchImpl } = fakeFetch(200, JSON.stringify({ txid }));
  const result = await requestPracticeFaucet({
    address: 'tb1qexample',
    sats: 50_000,
    faucetUrl: 'https://faucet.test/',
    fetchImpl,
  });
  assert.deepEqual(result, { txid });
  assert.equal(calls[0].url, 'https://faucet.test/api/onchain');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    sats: 50_000,
    address: 'tb1qexample',
  });
});

test('surfaces faucet refusals with their detail', async () => {
  const { fetchImpl } = fakeFetch(429, 'Too many requests, slow down');
  await assert.rejects(
    () => requestPracticeFaucet({ address: 'tb1qexample', fetchImpl }),
    /refused the request \(429\).*Too many requests/,
  );
});

test('rejects malformed faucet responses and bad amounts', async () => {
  const { fetchImpl } = fakeFetch(200, JSON.stringify({ ok: true }));
  await assert.rejects(
    () => requestPracticeFaucet({ address: 'tb1qexample', fetchImpl }),
    /unexpected response/,
  );
  await assert.rejects(
    () => requestPracticeFaucet({ address: 'tb1qexample', sats: 0, fetchImpl }),
    /whole number of sats/,
  );
});
