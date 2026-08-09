import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const LOCK_CONFIG_KEY = 'alice_app_lock_config';

export type LockConfig = {
  salt: string;
  pinHash: string;
  biometricEnabled: boolean;
  pinLength?: 4 | 6;
  pinKdf?: 'pbkdf2-v1';
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export async function loadLockConfig(): Promise<LockConfig | null> {
  if (Platform.OS === 'web') {
    const { loadWebLockConfig } = await import('@alice-wallet/wallet-core/web-vault');
    return loadWebLockConfig<LockConfig>();
  }
  const value = await SecureStore.getItemAsync(LOCK_CONFIG_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value) as LockConfig;
  } catch {
    return null;
  }
}

async function saveLockConfig(config: LockConfig): Promise<void> {
  if (Platform.OS === 'web') {
    const { saveWebLockConfig } = await import('@alice-wallet/wallet-core/web-vault');
    return saveWebLockConfig(config);
  }
  await SecureStore.setItemAsync(LOCK_CONFIG_KEY, JSON.stringify(config));
}

export function getPinLength(config: LockConfig): 4 | 6 {
  return config.pinLength === 4 ? 4 : 6;
}

export async function createPin(pin: string): Promise<void> {
  if (!/^\d{4}$|^\d{6}$/.test(pin)) throw new Error('PIN must contain exactly 4 or 6 digits.');
  const salt = bytesToHex(await Crypto.getRandomBytesAsync(16));
  const previousConfig = await loadLockConfig();
  const webPin = Platform.OS === 'web';
  const pinHash = webPin
    ? await (await import('@alice-wallet/wallet-core/web-vault')).deriveWebPinVerifier(pin, salt)
    : await hashPin(pin, salt);
  await saveLockConfig({
    salt,
    pinHash,
    biometricEnabled: false,
    pinLength: pin.length as 4 | 6,
    pinKdf: webPin ? 'pbkdf2-v1' : undefined,
  });
  if (Platform.OS === 'web') {
    try {
      const { setWebVaultPin } = await import('@alice-wallet/wallet-core/web-vault');
      await setWebVaultPin(pin);
    } catch (cause) {
      if (previousConfig) {
        await saveLockConfig(previousConfig);
      } else {
        const { clearWebLockConfig } = await import('@alice-wallet/wallet-core/web-vault');
        await clearWebLockConfig();
      }
      throw cause;
    }
  }
}

export async function verifyPin(pin: string): Promise<boolean> {
  const config = await loadLockConfig();
  if (!config || pin.length !== getPinLength(config) || !/^\d+$/.test(pin)) return false;
  if (Platform.OS === 'web') {
    const { deriveWebPinVerifier, unlockWebVault } = await import('@alice-wallet/wallet-core/web-vault');
    const candidate = config.pinKdf === 'pbkdf2-v1'
      ? await deriveWebPinVerifier(pin, config.salt)
      : await hashPin(pin, config.salt);
    if (candidate !== config.pinHash || !(await unlockWebVault(pin))) return false;
    if (config.pinKdf !== 'pbkdf2-v1') {
      await saveLockConfig({
        ...config,
        pinHash: await deriveWebPinVerifier(pin, config.salt),
        pinKdf: 'pbkdf2-v1',
      });
    }
    return true;
  }
  return (await hashPin(pin, config.salt)) === config.pinHash;
}

export async function isLockEnabled(): Promise<boolean> {
  return (await loadLockConfig()) !== null;
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  const config = await loadLockConfig();
  if (!config) throw new Error('Create a PIN first.');
  await saveLockConfig({ ...config, biometricEnabled: enabled });
}

export async function clearAppLock(): Promise<void> {
  if (Platform.OS === 'web') {
    const { clearWebLockConfig, clearWebVaultPin } = await import('@alice-wallet/wallet-core/web-vault');
    await clearWebVaultPin();
    return clearWebLockConfig();
  }
  await SecureStore.deleteItemAsync(LOCK_CONFIG_KEY);
}
