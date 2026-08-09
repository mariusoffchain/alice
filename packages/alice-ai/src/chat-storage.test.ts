import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeChatStorageValue,
  encodeChatStorageValue,
  isEncryptedChatStorageValue,
  planSessionCleanup,
  type ChatSession,
  type ChatStorageCipher,
} from './chat-storage.ts';

const testCipher: ChatStorageCipher = {
  async encrypt(plaintext, context) {
    return Buffer.from(`${context}\0${plaintext}`, 'utf8').toString('base64');
  },
  async decrypt(ciphertext, context) {
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
    const prefix = `${context}\0`;
    if (!decoded.startsWith(prefix)) throw new Error('Wrong storage context.');
    return decoded.slice(prefix.length);
  },
};

function sessions(count: number): ChatSession[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    title: `Session ${index}`,
    createdAt: count - index,
    updatedAt: count - index,
    messageCount: 2,
  }));
}

test('deletes the 10 oldest conversations', () => {
  const plan = planSessionCleanup(sessions(25), 'oldest-10');

  assert.equal(plan.kept.length, 15);
  assert.deepEqual(plan.removed.map(session => session.id), [
    'session-15',
    'session-16',
    'session-17',
    'session-18',
    'session-19',
    'session-20',
    'session-21',
    'session-22',
    'session-23',
    'session-24',
  ]);
});

test('keeps only the 10 newest conversations', () => {
  const plan = planSessionCleanup(sessions(25), 'keep-newest-10');

  assert.deepEqual(
    plan.kept.map(session => session.id),
    sessions(10).map((_, index) => `session-${index}`),
  );
  assert.equal(plan.removed.length, 15);
});

test('deleting all leaves no conversation', () => {
  const original = sessions(7);
  const plan = planSessionCleanup(original, 'all');

  assert.deepEqual(plan.removed, original);
  assert.deepEqual(plan.kept, []);
});

test('wraps encrypted values and authenticates their storage context', async () => {
  const plaintext = '{"title":"Private conversation"}';
  const encoded = await encodeChatStorageValue(
    plaintext,
    'alice_chat_sessions',
    testCipher,
  );

  assert.equal(isEncryptedChatStorageValue(encoded), true);
  assert.equal(encoded.includes('Private conversation'), false);
  assert.equal(
    await decodeChatStorageValue(encoded, 'alice_chat_sessions', testCipher),
    plaintext,
  );
  await assert.rejects(
    () => decodeChatStorageValue(encoded, 'alice_chat_session_other', testCipher),
    /Wrong storage context/,
  );
});

test('refuses encrypted chat data without its cipher', async () => {
  const encoded = await encodeChatStorageValue(
    'secret',
    'alice_chat_session_test',
    testCipher,
  );

  await assert.rejects(
    () => decodeChatStorageValue(encoded, 'alice_chat_session_test'),
    /unavailable without its encryption provider/,
  );
});
