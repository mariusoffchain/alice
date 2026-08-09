import type { ChatStorageCipher } from '@alice-wallet/alice-ai';
import { isTauriDesktop } from '@alice-wallet/alice-ai';

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: {
    invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
};

async function invokeTauri<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  const invoke = (window as TauriWindow).__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error('Alice Desktop encryption is unavailable.');
  return invoke<T>(command, args);
}

export function createTauriChatStorageCipher(): ChatStorageCipher | undefined {
  if (!isTauriDesktop()) return undefined;
  return {
    encrypt: (plaintext, context) => invokeTauri<string>(
      'chat_storage_encrypt',
      { plaintext, context },
    ),
    decrypt: (ciphertext, context) => invokeTauri<string>(
      'chat_storage_decrypt',
      { ciphertext, context },
    ),
  };
}
