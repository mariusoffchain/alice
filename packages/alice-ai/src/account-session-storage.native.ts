import * as SecureStore from 'expo-secure-store';

export function readAccountSessionValue(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export function writeAccountSessionValue(key: string, value: string): Promise<void> {
  return SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export function deleteAccountSessionValue(key: string): Promise<void> {
  return SecureStore.deleteItemAsync(key);
}
