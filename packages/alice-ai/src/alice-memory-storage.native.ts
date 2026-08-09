import * as SecureStore from 'expo-secure-store';
import type { AliceMemoryStorage } from './alice-memory-core';

const MEMORY_KEY = 'alice_personal_memory_v1';

export const aliceMemoryStorage: AliceMemoryStorage = {
  read: () => SecureStore.getItemAsync(MEMORY_KEY),
  write: value => SecureStore.setItemAsync(MEMORY_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  remove: () => SecureStore.deleteItemAsync(MEMORY_KEY),
};
