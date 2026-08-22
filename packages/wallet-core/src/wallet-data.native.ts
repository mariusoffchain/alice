import * as SQLite from 'expo-sqlite';

export async function clearLocalWalletRepository(): Promise<void> {
  // Best effort: on a fresh install, or right after a reset, there is no
  // database yet, and Expo SQLite rejects the deletion of a missing file.
  // "Nothing to delete" is the outcome we want, not an error.
  await SQLite.deleteDatabaseAsync('alice-ark.db').catch(() => {});
}

/** The Satora swap records, which belong to one seed and mean nothing to the next. */
export async function clearLocalSwapRepository(): Promise<void> {
  await SQLite.deleteDatabaseAsync('alice-swaps.db').catch(() => {});
}
