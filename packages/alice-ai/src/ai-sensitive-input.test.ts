import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSensitiveInput } from './ai-sensitive-input.ts';

const RAW_HEX = '1'.repeat(64);

test('blocks a labeled raw hexadecimal private key', () => {
  assert.equal(
    detectSensitiveInput(`Please remember that my private key is ${RAW_HEX}`)?.kind,
    'private_key',
  );
  assert.equal(
    detectSensitiveInput(`Ma clé privée est ${RAW_HEX}`)?.kind,
    'private_key',
  );
});

test('does not mistake an explicitly labeled txid for a private key', () => {
  assert.equal(detectSensitiveInput(`Can you explain this txid: ${RAW_HEX}`), null);
});
