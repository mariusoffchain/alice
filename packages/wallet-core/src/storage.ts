import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const MNEMONIC_KEY = 'alice_wallet_mnemonic';
const PUBKEY_KEY = 'alice_wallet_pubkey';
const ONBOARDED_KEY = 'alice_onboarded';
const BACKUP_COMPLETE_KEY = 'alice_backup_complete';
const ARK_TASK_QUEUE_KEYS = [
  'ark:task-queue:inbox',
  'ark:task-queue:outbox',
  'ark:task-queue:config',
];
const DIAGNOSTIC_LOG_KEY = 'alice_diagnostic_logs';

export async function saveMnemonic(mnemonic: string): Promise<void> {
  if (Platform.OS === 'web') {
    const { saveWebMnemonic } = await import('./web-vault');
    return saveWebMnemonic(mnemonic);
  }
  await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic);
}

export async function loadMnemonic(): Promise<string | null> {
  if (Platform.OS === 'web') {
    const { loadWebMnemonic } = await import('./web-vault');
    return loadWebMnemonic();
  }
  return SecureStore.getItemAsync(MNEMONIC_KEY);
}

export async function savePublicKey(hex: string): Promise<void> {
  await AsyncStorage.setItem(PUBKEY_KEY, hex);
}

export async function loadPublicKey(): Promise<string | null> {
  return AsyncStorage.getItem(PUBKEY_KEY);
}

export async function clearWallet(): Promise<void> {
  const { clearWalletBackendData } = await import('./ark');
  const { clearAppLock } = await import('./app-lock');
  const { clearDelegateRenewalPreference } = await import('./delegate-settings');
  await clearWalletBackendData();
  await clearAppLock();
  await clearDelegateRenewalPreference();
  if (Platform.OS === 'web') {
    const { clearWebVault } = await import('./web-vault');
    await clearWebVault();
    await AsyncStorage.multiRemove([PUBKEY_KEY, ONBOARDED_KEY, BACKUP_COMPLETE_KEY, DIAGNOSTIC_LOG_KEY, ...ARK_TASK_QUEUE_KEYS]);
    return;
  }
  await SecureStore.deleteItemAsync(MNEMONIC_KEY);
  await AsyncStorage.multiRemove([PUBKEY_KEY, ONBOARDED_KEY, BACKUP_COMPLETE_KEY, DIAGNOSTIC_LOG_KEY, ...ARK_TASK_QUEUE_KEYS]);
}
