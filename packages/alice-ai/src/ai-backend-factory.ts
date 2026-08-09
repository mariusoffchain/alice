import { Platform } from 'react-native';
import type { AIBackend, AIBackendType } from './ai-backend';
import { CloudAIBackend } from './ai-backend-cloud';
import { CustomAIBackend } from './ai-backend-custom';
import { LocalAIBackend, isLocalAvailable } from './ai-backend-local';
import { LocalDesktopAIBackend } from './ai-backend-local-desktop';
import { isTauriDesktop } from './tauri-runtime';

export { isTauriDesktop } from './tauri-runtime';

export function createBackend(type: AIBackendType): AIBackend {
  if (type === 'local') return isTauriDesktop() ? new LocalDesktopAIBackend() : new LocalAIBackend();
  if (type === 'custom') return new CustomAIBackend();
  return new CloudAIBackend();
}

export function canUseLocal(): boolean {
  return isTauriDesktop() || (Platform.OS !== 'web' && isLocalAvailable());
}
