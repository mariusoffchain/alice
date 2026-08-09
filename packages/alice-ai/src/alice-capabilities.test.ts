import assert from 'node:assert/strict';
import test from 'node:test';
import { ALICE_CAPABILITIES, getAliceCapability } from './alice-capabilities.ts';

test('future visual outputs have explicit capability boundaries', () => {
  assert.equal(getAliceCapability('image-generation').availability, 'planned');
  assert.equal(getAliceCapability('diagram-generation').availability, 'planned');
});

test('a future wallet action can never be declared confirmation-free', () => {
  assert.equal(getAliceCapability('wallet-action').requiresUserConfirmation, true);
  assert.equal(ALICE_CAPABILITIES.some(capability => capability.id === 'knowledge-retrieval'), true);
});
