import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { loadMnemonic } from '@alice-wallet/wallet-core';

const ONBOARDED_KEY = 'alice_onboarded';
const BACKUP_COMPLETE_KEY = 'alice_backup_complete';

export async function isOnboarded(): Promise<boolean> {
  if (Platform.OS === 'web') {
    const { isWebOnboarded } = await import('@alice-wallet/wallet-core/web-vault');
    return isWebOnboarded();
  }
  const val = await AsyncStorage.getItem(ONBOARDED_KEY);
  return val === 'true' && (await loadMnemonic()) !== null;
}

export async function markOnboarded(): Promise<void> {
  if (Platform.OS === 'web') {
    const { markWebOnboarded } = await import('@alice-wallet/wallet-core/web-vault');
    return markWebOnboarded();
  }
  await AsyncStorage.setItem(ONBOARDED_KEY, 'true');
}

export async function isBackupComplete(): Promise<boolean> {
  if (Platform.OS === 'web') {
    const { isWebBackupComplete } = await import('@alice-wallet/wallet-core/web-vault');
    return isWebBackupComplete();
  }
  return (await AsyncStorage.getItem(BACKUP_COMPLETE_KEY)) === 'true';
}

export async function markBackupComplete(): Promise<void> {
  if (Platform.OS === 'web') {
    const { markWebBackupComplete } = await import('@alice-wallet/wallet-core/web-vault');
    return markWebBackupComplete();
  }
  await AsyncStorage.setItem(BACKUP_COMPLETE_KEY, 'true');
}
