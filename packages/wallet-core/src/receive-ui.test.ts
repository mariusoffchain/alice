import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  decodeURIComponent(new URL('../../../apps/wallet-mobile/app/receive.tsx', import.meta.url).pathname),
  'utf8',
);

test('receive watcher stays visible once a payment QR is available', () => {
  assert.match(source, /\{qrValue && !showSuccess && \(/);
  assert.doesNotMatch(source, /initialBalance !== null && \(receiveMode/);
});

test('receive watcher synchronizes and detects new VTXOs before using balance fallback', () => {
  const watcher = source.slice(
    source.indexOf('const checkForPayment'),
    source.indexOf('useEffect(() => {', source.indexOf('const checkForPayment')),
  );
  assert.match(watcher, /await syncVtxosIfReady\(\)/);
  assert.match(watcher, /findNewReceivedVtxo/);
  assert.doesNotMatch(watcher, /getTransactionHistory\(\)/);
  assert.ok(watcher.indexOf('findNewReceivedVtxo') < watcher.indexOf('balanceResult.status'));
});
