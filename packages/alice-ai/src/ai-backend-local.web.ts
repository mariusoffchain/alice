import type { AIBackend, AIBackendStatus, AIResponse } from './ai-backend';
import type { Message } from './llm';

export class LocalAIBackend implements AIBackend {
  readonly type = 'local' as const;

  async init(): Promise<void> {}

  status(): AIBackendStatus {
    return { state: 'error', message: 'Local AI requires the Alice Wallet native app.' };
  }

  sendMessage(_messages: Message[], _onChunk?: (chunk: string) => void): Promise<AIResponse> {
    return Promise.reject(new Error('Local AI is not available on the web.'));
  }

  async dispose(): Promise<void> {}
}

export function isLocalAvailable(): boolean {
  return false;
}
