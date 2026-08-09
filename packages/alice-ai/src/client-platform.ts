// Web and Tauri desktop build. Metro picks client-platform.native.ts for the
// iOS/Android builds instead, which is why react-native is not imported here.
// Keep this import extensionless: adding .ts would defeat Metro's platform
// resolution.
import { isTauriDesktop } from './tauri-runtime';
import { desktopPlatformFromHint, type AlicePlatform } from './client-info-format';

export function resolveAlicePlatform(): AlicePlatform {
  if (!isTauriDesktop()) return 'web';
  const hint = typeof navigator !== 'undefined'
    ? `${navigator.userAgent ?? ''} ${(navigator as { platform?: string }).platform ?? ''}`
    : '';
  return desktopPlatformFromHint(hint);
}
