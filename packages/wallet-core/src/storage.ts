import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createRecoveryScanFlag } from './recovery-scan-flag';

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
  const { seedGeneration } = await import('./seed-generation');
  if (Platform.OS === 'web') {
    const { saveWebMnemonic } = await import('./web-vault');
    await saveWebMnemonic(mnemonic);
    seedGeneration.bump();
    return;
  }
  await SecureStore.setItemAsync(MNEMONIC_KEY, mnemonic);
  seedGeneration.bump();
}

// The home screen's cached balance and recent entries. Owned by the app, but
// it belongs to one seed like everything else here, and it survived a reset.
const HOME_SNAPSHOT_KEY = 'alice_wallet_home_snapshot_v1';

// The "deep recovery scan still has to finish" flag, one marker per pass
// (see recovery-scan-flag.ts): a pass that outlives a seed change cannot
// clear what the next seed recorded.
const recoveryScanFlag = createRecoveryScanFlag(AsyncStorage, () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const markRecoveryScanPending = (): Promise<string> => recoveryScanFlag.mark();
export const loadRecoveryScanToken = (): Promise<string | null> => recoveryScanFlag.current();
export const clearRecoveryScanPending = (token: string): Promise<void> => recoveryScanFlag.clear(token);
export const isRecoveryScanPending = (): Promise<boolean> => recoveryScanFlag.isPending();
const resetRecoveryScan = (): Promise<void> => recoveryScanFlag.reset();

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

/**
 * Everything a previous seed left behind, short of the phrase itself, so a
 * new phrase starts from nothing. The phrase is overwritten by the caller.
 */
export async function forgetWalletForNewSeed(): Promise<void> {
  const { discardWalletForNewSeed } = await import('./ark');
  await discardWalletForNewSeed();
  await resetRecoveryScan();
  await AsyncStorage.multiRemove([PUBKEY_KEY, BACKUP_COMPLETE_KEY, HOME_SNAPSHOT_KEY, ...ARK_TASK_QUEUE_KEYS]);
}

export async function clearWallet(): Promise<void> {
  await resetRecoveryScan();
  const { clearWalletBackendData } = await import('./ark');
  const { clearAppLock } = await import('./app-lock');
  const { clearDelegateRenewalPreference } = await import('./delegate-settings');
  await clearWalletBackendData();
  await clearAppLock();
  await clearDelegateRenewalPreference();
  if (Platform.OS === 'web') {
    const { clearWebVault } = await import('./web-vault');
    await clearWebVault();
    await AsyncStorage.multiRemove([PUBKEY_KEY, ONBOARDED_KEY, BACKUP_COMPLETE_KEY, DIAGNOSTIC_LOG_KEY, HOME_SNAPSHOT_KEY, ...ARK_TASK_QUEUE_KEYS]);
    return;
  }
  await SecureStore.deleteItemAsync(MNEMONIC_KEY);
  await AsyncStorage.multiRemove([PUBKEY_KEY, ONBOARDED_KEY, BACKUP_COMPLETE_KEY, DIAGNOSTIC_LOG_KEY, HOME_SNAPSHOT_KEY, ...ARK_TASK_QUEUE_KEYS]);
}
