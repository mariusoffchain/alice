import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const SECURE_PROFILE_KEY = 'alice_learning_profile_v3';
const LEGACY_PROFILE_KEY = 'alice_pedagogical_profile_v1';

import type { PedagogicalProfileStorage } from './pedagogical-profile-core';

export const pedagogicalProfileStorage: PedagogicalProfileStorage = {
  read: () => SecureStore.getItemAsync(SECURE_PROFILE_KEY),
  write: value => SecureStore.setItemAsync(SECURE_PROFILE_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  remove: () => SecureStore.deleteItemAsync(SECURE_PROFILE_KEY),
  readLegacy: async () => {
    const secure = await SecureStore.getItemAsync(LEGACY_PROFILE_KEY);
    return secure ?? AsyncStorage.getItem(LEGACY_PROFILE_KEY);
  },
  removeLegacy: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(LEGACY_PROFILE_KEY),
      AsyncStorage.removeItem(LEGACY_PROFILE_KEY),
    ]);
  },
};
