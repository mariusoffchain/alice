import assert from 'node:assert/strict';
import test from 'node:test';
import { ALICE_LOCAL_DATA_KNOWLEDGE } from './product-knowledge.ts';

test('Alice product knowledge covers local storage and recovery rules', () => {
  assert.ok(ALICE_LOCAL_DATA_KNOWLEDGE.keywords.includes('discussion history'));
  assert.match(ALICE_LOCAL_DATA_KNOWLEDGE.content, /limits it to 50 conversations/);
  assert.match(ALICE_LOCAL_DATA_KNOWLEDGE.content, /operating system keychain/);
  assert.match(ALICE_LOCAL_DATA_KNOWLEDGE.content, /seed phrase restores the wallet identity/);
  assert.match(ALICE_LOCAL_DATA_KNOWLEDGE.content, /Pending or refundable swap records/);
});
