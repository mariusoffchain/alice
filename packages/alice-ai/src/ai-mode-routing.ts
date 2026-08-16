import type { AIBackendType } from './ai-backend';
import type { AIBackendEnabledState } from './ai-preferences';

export type InitialBackendOptions = {
  storedBackend: string | null;
  privateCloudEnabled: boolean;
  enabled: AIBackendEnabledState;
  localAvailable: boolean;
  customConfigured: boolean;
  preferLocal: boolean;
};

export function chooseInitialBackend(options: InitialBackendOptions): AIBackendType {
  const {
    storedBackend,
    privateCloudEnabled,
    enabled,
    localAvailable,
    customConfigured,
    preferLocal,
  } = options;

  if (storedBackend === 'cloud' && privateCloudEnabled && enabled.cloud) return 'cloud';
  if (storedBackend === 'local' && localAvailable && enabled.local) return 'local';
  if (storedBackend === 'custom' && customConfigured && enabled.custom) return 'custom';
  if (preferLocal && localAvailable && enabled.local) return 'local';
  if (privateCloudEnabled && enabled.cloud) return 'cloud';
  if (localAvailable && enabled.local) return 'local';
  if (customConfigured && enabled.custom) return 'custom';
  if (enabled.custom) return 'custom';
  if (privateCloudEnabled) return 'cloud';
  if (localAvailable) return 'local';
  return 'custom';
}

export function fallbackAfterBackendDisabled(options: {
  disabledBackend: AIBackendType;
  privateCloudEnabled: boolean;
  enabled: AIBackendEnabledState;
  localAvailable: boolean;
}): AIBackendType {
  const { disabledBackend, privateCloudEnabled, enabled, localAvailable } = options;
  const candidates: AIBackendType[] = disabledBackend === 'cloud'
    ? ['local', 'custom']
    : disabledBackend === 'local'
      ? ['cloud', 'custom']
      : ['cloud', 'local'];

  for (const candidate of candidates) {
    if (candidate === 'cloud' && privateCloudEnabled && enabled.cloud) return candidate;
    if (candidate === 'local' && localAvailable && enabled.local) return candidate;
    if (candidate === 'custom' && enabled.custom) return candidate;
  }
  return disabledBackend;
}
