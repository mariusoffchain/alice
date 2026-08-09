import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeChatStorageValue,
  isEncryptedChatStorageValue,
  migrateChatStorageValues,
  type ChatStorageAdapter,
  type ChatStorageCipher,
} from './chat-storage.ts';

const values = new Map<string, string>();
const storage: ChatStorageAdapter = {
  async getItem(key) {
    return values.get(key) ?? null;
  },
  async setItem(key, value) {
    values.set(key, value);
  },
};

const cipher: ChatStorageCipher = {
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

test('migrates an existing plaintext conversation and index before reading them', async () => {
  values.clear();
  values.set('alice_chat_sessions', JSON.stringify([{
    id: 'legacy',
    title: 'Legacy private title',
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
  }]));
  values.set('alice_chat_session_legacy', JSON.stringify([{
    id: 'message-1',
    role: 'user',
    content: 'Legacy private message',
    time: '2026-01-01T00:00:00.000Z',
  }]));

  await migrateChatStorageValues(storage, cipher);
  const encryptedIndex = values.get('alice_chat_sessions') ?? '';
  const encryptedSession = values.get('alice_chat_session_legacy') ?? '';
  const sessions = JSON.parse(await decodeChatStorageValue(
    encryptedIndex,
    'alice_chat_sessions',
    cipher,
  ));
  const messages = JSON.parse(await decodeChatStorageValue(
    encryptedSession,
    'alice_chat_session_legacy',
    cipher,
  ));

  assert.equal(sessions[0]?.title, 'Legacy private title');
  assert.equal(messages[0]?.content, 'Legacy private message');
  assert.equal(isEncryptedChatStorageValue(encryptedIndex), true);
  assert.equal(isEncryptedChatStorageValue(encryptedSession), true);
  assert.equal(encryptedIndex.includes('Legacy private title'), false);
  assert.equal(encryptedSession.includes('Legacy private message'), false);
});
