import AsyncStorage from '@react-native-async-storage/async-storage';
import { NETWORK } from './network-config';

const DELEGATE_ENABLED_KEY = 'alice_delegate_renewal_enabled_v1';

export const DELEGATE_URL =
  NETWORK === 'bitcoin'
    ? 'https://delegate.arkade.money'
    : 'https://delegator.mutinynet.arkade.sh';

export async function isDelegateRenewalEnabled(): Promise<boolean> {
  const value = await AsyncStorage.getItem(DELEGATE_ENABLED_KEY);
  return value === null ? true : value === 'true';
}

export async function saveDelegateRenewalEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(DELEGATE_ENABLED_KEY, String(enabled));
}

export async function clearDelegateRenewalPreference(): Promise<void> {
  await AsyncStorage.removeItem(DELEGATE_ENABLED_KEY);
}
