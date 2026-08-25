import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function walletPage(name: string) {
  return readFileSync(
    decodeURIComponent(new URL(`../../../apps/wallet-mobile/app/${name}`, import.meta.url).pathname),
    'utf8',
  );
}

test('history paints local snapshots before background synchronization', () => {
  const source = walletPage('history.tsx');
  assert.match(source, /getCachedTransactionHistory\(\)/);
  assert.match(source, /getTransactionHistory\(\)\.then/);
  assert.match(source, /getPaymentHistory\(\)\.then/);
  assert.match(source, /refreshTransactionHistory\(\)/);
  assert.match(source, /refreshPaymentHistory\(\)/);
  assert.match(source, /LOADING RECENT ACTIVITY/);
  assert.doesNotMatch(
    source,
    /syncVtxosIfReady\(\)[\s\S]{0,120}getTransactionHistory\(\), getPaymentHistory\(\)/,
  );
});

test('emergency exit stops with a visible retry state when loading fails', () => {
  const source = walletPage('emergency-exit.tsx');
  assert.match(source, /!loading && !state && error/);
  assert.match(source, />RETRY</);
});

test('server status uses user-facing labels and a partial state', () => {
  const source = walletPage('advanced-server.tsx');
  assert.match(source, /BITCOIN EXPLORER/);
  assert.match(source, /PARTIAL CONNECTION/);
  assert.doesNotMatch(source, /\['ESPLORA', ESPLORA_URL\]/);
});

test('failed backend cleanup cannot hold the UI indefinitely', () => {
  const source = readFileSync(
    decodeURIComponent(new URL('./backend-slot.ts', import.meta.url).pathname),
    'utf8',
  );
  // A failed initialisation lets go of its backend without waiting on it,
  // and every dispose is bounded in time.
  assert.match(source, /void disposeQuietly\(next\)/);
  assert.doesNotMatch(source, /await next\.dispose\(\)/);
  assert.match(source, /withTimeout\(\s*target\.dispose\(\)/);
});
