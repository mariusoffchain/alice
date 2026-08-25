import type { AIBackendType } from './ai-backend';
import type { AIBackendEnabledState } from './ai-preferences';

export function getAIDisabledMessage(
  aiEnabled: boolean,
  backendType: AIBackendType,
  backendEnabled: AIBackendEnabledState,
): string | null {
  if (!aiEnabled) {
    return 'Alice AI is disabled. Re-enable Alice in settings before sending a message.';
  }
  if (backendEnabled[backendType]) return null;

  const label = backendType === 'cloud'
    ? 'Cloud'
    : backendType === 'local'
      ? 'Local'
      : 'Custom server';
  return `${label} AI is disabled. Re-enable this model in Alice settings before sending a message.`;
}
