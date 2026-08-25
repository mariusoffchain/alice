import type { PlaygroundView } from '@/lib/playground-signals';

// One-shot handoff into the Playground: Learn's "try it" buttons (and later
// the chat's suggestions) ask for a specific view, and the panel consumes it
// on mount. Same reasoning as the Explorer's pending-open channel: writing
// another section's state directly would race its own persistence, a
// dedicated channel cannot. sessionStorage, so a stale request never
// outlives the tab.

const KEY = 'alice.playground.pending-view';

const VIEWS: readonly PlaygroundView[] = [
  'home', 'send', 'receive', 'settings', 'coins', 'addresses', 'backup', 'faucet',
];

export function requestPlaygroundView(view: PlaygroundView): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, view);
  } catch {
    // Best effort: the Playground just opens on its home view.
  }
}

export function consumePendingPlaygroundView(): PlaygroundView | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw !== null) window.sessionStorage.removeItem(KEY);
    return raw !== null && (VIEWS as readonly string[]).includes(raw)
      ? (raw as PlaygroundView)
      : null;
  } catch {
    return null;
  }
}
