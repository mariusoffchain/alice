import { isNewerVersion } from './app-update-format.ts';

type Store = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
};
const SEEN_KEY = 'alice.whats-new.seen.v1';
const validVersion = (value: string | null): value is string => !!value && /^\d+\.\d+\.\d+$/.test(value);

/** Reading an upgrade must not consume it: effects can be cancelled or replayed. */
export async function pendingWhatsNew(store: Store, current: string | null): Promise<string | null> {
  if (!validVersion(current)) return null;
  try {
    const seen = await store.getItem(SEEN_KEY);
    if (!validVersion(seen)) {
      await store.setItem(SEEN_KEY, current);
      return null;
    }
    return isNewerVersion(current, seen) ? current : null;
  } catch { return null; }
}

/** Acknowledge only after dismissal; an older tab must not regress the marker. */
export async function acknowledgeWhatsNew(store: Store, version: string): Promise<void> {
  if (!validVersion(version)) return;
  try {
    const seen = await store.getItem(SEEN_KEY);
    if (!validVersion(seen) || isNewerVersion(version, seen)) await store.setItem(SEEN_KEY, version);
  } catch { /* Storage restrictions must not prevent closing the dialog. */ }
}
