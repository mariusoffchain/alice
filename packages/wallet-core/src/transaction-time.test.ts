import assert from 'node:assert/strict';
import test from 'node:test';
import { TransactionTimeCache } from './wallet-backend.ts';

test('keeps a valid transaction timestamp', () => {
  const cache = new TransactionTimeCache();
  assert.equal(cache.resolve('tx', 1_785_231_900_000, 123), 1_785_231_900_000);
});

test('uses local detection time while an unconfirmed transaction has no timestamp', () => {
  const cache = new TransactionTimeCache();
  assert.equal(cache.resolve('tx', 0, 1_785_231_900_000), 1_785_231_900_000);
  assert.equal(cache.resolve('tx', 0, 1_785_231_910_000), 1_785_231_900_000);
});

test('replaces detection time when the network timestamp arrives', () => {
  const cache = new TransactionTimeCache();
  cache.resolve('tx', 0, 1_785_231_900_000);
  assert.equal(cache.resolve('tx', 1_785_231_905_000), 1_785_231_905_000);
});
