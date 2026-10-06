import * as SecureStore from 'expo-secure-store';
import type { AliceMemoryStorage } from './alice-memory-core';
import { createAliceMemoryTieredStorage } from './alice-memory-tiered-storage';

const MEMORY_KEY = 'alice_personal_memory_v1';
const MEMORY_FILE_KEY = 'alice_personal_memory_file_key_v1';
const MEMORY_DIRECTORY = 'alice-memory/';
const MEMORY_FILE = 'memory.enc';

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function memoryFileUri(create: boolean): Promise<string | null> {
  const FileSystem = await import('expo-file-system/legacy');
  if (!FileSystem.documentDirectory) return null;
  const directory = `${FileSystem.documentDirectory}${MEMORY_DIRECTORY}`;
  if (create) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return `${directory}${MEMORY_FILE}`;
}

export const aliceMemoryStorage: AliceMemoryStorage = createAliceMemoryTieredStorage({
  valueKey: MEMORY_KEY,
  fileKeyKey: MEMORY_FILE_KEY,
  secure: {
    get: key => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
    remove: key => SecureStore.deleteItemAsync(key),
  },
  file: {
    read: async () => {
      const FileSystem = await import('expo-file-system/legacy');
      const uri = await memoryFileUri(false);
      if (!uri) return null;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return null;
      return FileSystem.readAsStringAsync(uri);
    },
    write: async value => {
      const FileSystem = await import('expo-file-system/legacy');
      const uri = await memoryFileUri(true);
      if (!uri) throw new Error('The app documents directory is unavailable.');
      await FileSystem.writeAsStringAsync(uri, value);
    },
    remove: async () => {
      const FileSystem = await import('expo-file-system/legacy');
      const uri = await memoryFileUri(false);
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
    },
  },
});
