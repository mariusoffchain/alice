import { isTauriDesktop, tauriInvoke } from './tauri-runtime';

const PROFILE_KEY = 'alice_learning_profile_v3';
const LEGACY_PROFILE_KEY = 'alice_pedagogical_profile_v1';
const PROFILE_CONTEXT = 'alice_learning_profile_v3';
const LEGACY_PROFILE_CONTEXT = 'alice_pedagogical_profile_v2';

import type { PedagogicalProfileStorage } from './pedagogical-profile-core';

// Browser storage is intentionally local to the browser profile. On Desktop,
// the same value is encrypted before it reaches the webview store; the AES key
// stays in the operating-system keychain and never enters JavaScript storage.
export const pedagogicalProfileStorage: PedagogicalProfileStorage = {
  read: async () => {
    const value = localProfileStorage()?.getItem(PROFILE_KEY) ?? null;
    if (!value || !isTauriDesktop()) return value;
    if (!value.startsWith('v1:')) return value;
    return tauriInvoke<string>('chat_storage_decrypt', {
      ciphertext: value,
      context: PROFILE_CONTEXT,
    });
  },
  write: async value => {
    const storage = localProfileStorage();
    if (!storage) throw new Error('Browser storage is unavailable.');
    if (!isTauriDesktop()) {
      storage.setItem(PROFILE_KEY, value);
      return;
    }
    const ciphertext = await tauriInvoke<string>('chat_storage_encrypt', {
      plaintext: value,
      context: PROFILE_CONTEXT,
    });
    storage.setItem(PROFILE_KEY, ciphertext);
  },
  remove: async () => { localProfileStorage()?.removeItem(PROFILE_KEY); },
  readLegacy: async () => {
    const value = localProfileStorage()?.getItem(LEGACY_PROFILE_KEY) ?? null;
    if (!value || !isTauriDesktop() || !value.startsWith('v1:')) return value;
    return tauriInvoke<string>('chat_storage_decrypt', {
      ciphertext: value,
      context: LEGACY_PROFILE_CONTEXT,
    });
  },
  removeLegacy: async () => { localProfileStorage()?.removeItem(LEGACY_PROFILE_KEY); },
};

function localProfileStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
