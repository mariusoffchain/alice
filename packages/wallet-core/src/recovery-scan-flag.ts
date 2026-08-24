/**
 * The "deep recovery scan still has to finish" flag, kept so that a pass
 * started for one seed can never clear what the next seed recorded.
 *
 * Two kinds of keys: one marker per pass (`prefix + token`), and a pointer
 * to the pass that currently matters. Clearing a pass removes only its own
 * marker, in a single write: there is no read-then-delete that a
 * concurrent seed change could slip between. A stale pass from a previous
 * seed therefore leaves the new seed's marker untouched, and its orphaned
 * marker is swept when the seed changes.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

const POINTER_KEY = 'alice_recovery_scan_pending_v2';
const MARKER_PREFIX = 'alice_recovery_scan_pass_v2:';

export function createRecoveryScanFlag(store: KeyValueStore, newToken: () => string) {
  return {
    /** Records a new pass as the one that matters; returns its token. */
    async mark(): Promise<string> {
      const token = newToken();
      await store.setItem(MARKER_PREFIX + token, '1');
      await store.setItem(POINTER_KEY, token);
      return token;
    },

    /** The token of the pass that matters, if it is still unfinished. */
    async current(): Promise<string | null> {
      const token = await store.getItem(POINTER_KEY);
      if (!token) return null;
      return (await store.getItem(MARKER_PREFIX + token)) === null ? null : token;
    },

    /** Finishes one pass. Only that pass's marker goes; nothing else is read or written. */
    async clear(token: string): Promise<void> {
      await store.removeItem(MARKER_PREFIX + token);
    },

    async isPending(): Promise<boolean> {
      return (await this.current()) !== null;
    },

    /** Everything, for a seed change or a wallet reset. */
    async reset(): Promise<void> {
      const keys = (await store.getAllKeys()).filter(key => key === POINTER_KEY || key.startsWith(MARKER_PREFIX));
      if (keys.length) await store.multiRemove(keys);
    },
  };
}
