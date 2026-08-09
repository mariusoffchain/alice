import type { AliceMemoryStorage } from './alice-memory-core';
import { isTauriDesktop, tauriInvoke } from './tauri-runtime';

const MEMORY_KEY = 'alice_personal_memory_v1';
const MEMORY_CONTEXT = 'alice_personal_memory_v1';

function localMemoryStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const aliceMemoryStorage: AliceMemoryStorage = {
  read: async () => {
    const value = localMemoryStorage()?.getItem(MEMORY_KEY) ?? null;
    if (!value || !isTauriDesktop() || !value.startsWith('v1:')) return value;
    return tauriInvoke<string>('chat_storage_decrypt', { ciphertext: value, context: MEMORY_CONTEXT });
  },
  write: async value => {
    const storage = localMemoryStorage();
    if (!storage) throw new Error('Browser storage is unavailable.');
    if (!isTauriDesktop()) {
      storage.setItem(MEMORY_KEY, value);
      return;
    }
    const ciphertext = await tauriInvoke<string>('chat_storage_encrypt', {
      plaintext: value,
      context: MEMORY_CONTEXT,
    });
    storage.setItem(MEMORY_KEY, ciphertext);
  },
  remove: async () => { localMemoryStorage()?.removeItem(MEMORY_KEY); },
};
