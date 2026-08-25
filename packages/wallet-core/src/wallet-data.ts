import { WEB_DB_NAME } from './network-config';
import { ARKADE_CACHE_NAMES } from './arkade-cache-repositories';

/** Web keeps its swap records alongside the wallet database; nothing extra to drop. */
export async function clearLocalSwapRepository(): Promise<void> {}

export async function clearLocalWalletRepository(): Promise<void> {
  await Promise.all([
    ...[WEB_DB_NAME, 'alice-ark-web'].map(deleteDatabaseBestEffort),
    ...ARKADE_CACHE_NAMES.map(deleteCacheBestEffort),
  ]);
}

function deleteDatabaseBestEffort(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    try {
      const deletion = indexedDB.deleteDatabase(name);
      deletion.onsuccess = done;
      deletion.onerror = done;
      deletion.onblocked = done;
    } catch {
      done();
      return;
    }
    // Safari can leave deleteDatabase pending without firing any handler when a
    // connection is still open; resolve anyway so the reset never hangs.
    setTimeout(done, 4000);
  });
}

async function deleteCacheBestEffort(name: string): Promise<void> {
  try {
    await globalThis.caches?.delete(name);
  } catch {
    // Reset remains best-effort when Safari blocks a storage engine.
  }
}
