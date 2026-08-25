import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  decodeURIComponent(new URL('../../../apps/wallet-mobile/app/transaction.tsx', import.meta.url).pathname),
  'utf8',
);

test('payment and transaction details remain vertically scrollable', () => {
  assert.match(source, /import \{[^}]*ScrollView[^}]*\} from 'react-native'/);
  assert.equal(source.match(/<ScrollView/g)?.length, 2);
  assert.equal(source.match(/contentContainerStyle=\{s\.body\}/g)?.length, 2);
});

test('payment details do not repeat an identical Arkade funding txid', () => {
  assert.match(
    source,
    /paymentData\.arkadeFundingTxid !== paymentData\.fundingTxid/,
  );
});
