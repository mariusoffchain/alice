import AsyncStorage from '@react-native-async-storage/async-storage';

export function readAccountSessionValue(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export function writeAccountSessionValue(key: string, value: string): Promise<void> {
  return AsyncStorage.setItem(key, value);
}

export function deleteAccountSessionValue(key: string): Promise<void> {
  return AsyncStorage.removeItem(key);
}
