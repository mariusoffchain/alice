import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePaymentInput } from './payment-parser.ts';

const MAINNET_ADDRESS = `bc1q${'q'.repeat(40)}`;
const TESTNET_ADDRESS = `tb1q${'q'.repeat(40)}`;

test('payment parser rejects mainnet bitcoin addresses on mutinynet', () => {
  assert.equal(parsePaymentInput(MAINNET_ADDRESS, 'mutinynet'), null);
});

test('payment parser rejects testnet bitcoin addresses on bitcoin mainnet', () => {
  assert.equal(parsePaymentInput(TESTNET_ADDRESS, 'bitcoin'), null);
});

test('payment parser accepts bitcoin addresses only on the matching network', () => {
  assert.equal(parsePaymentInput(MAINNET_ADDRESS, 'bitcoin')?.routes[0]?.destination, MAINNET_ADDRESS);
  assert.equal(parsePaymentInput(TESTNET_ADDRESS, 'mutinynet')?.routes[0]?.destination, TESTNET_ADDRESS);
});
