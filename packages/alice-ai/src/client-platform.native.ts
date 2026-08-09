// iOS and Android build. Metro resolves this over client-platform.ts.
import { Platform } from 'react-native';
import type { AlicePlatform } from './client-info-format';

export function resolveAlicePlatform(): AlicePlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}
