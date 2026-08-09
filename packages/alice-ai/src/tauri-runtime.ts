// Tauri 2 injects __TAURI_INTERNALS__ into every webview. @tauri-apps/api/core
// is a typed wrapper around this same object; using it directly keeps the
// shared AI package free of an additional desktop-only dependency.
export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

type TauriInvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export function tauriInvoke<T = void>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const w = window as unknown as { __TAURI_INTERNALS__?: { invoke: TauriInvokeFn } };
  const fn = w.__TAURI_INTERNALS__?.invoke;
  if (!fn) throw new Error('tauriInvoke called outside Tauri webview');
  return fn.call(w.__TAURI_INTERNALS__, cmd, args) as Promise<T>;
}
