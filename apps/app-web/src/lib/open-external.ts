import { isTauriDesktop } from '@alice-wallet/alice-ai';

// Tauri 2's plugin-shell is invoked over the same raw IPC channel used by
// isTauriDesktop()/tauriInvoke() in alice-ai, to avoid adding @tauri-apps/api
// as a dependency just for this one call.
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriDesktop()) {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
    await w.__TAURI_INTERNALS__?.invoke('plugin:shell|open', { path: url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
