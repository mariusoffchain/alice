import * as SQLite from 'expo-sqlite';
import { addDiagnosticLog } from './diagnostic-log';

export async function clearLocalWalletRepository(): Promise<void> {
  // Best effort: on a fresh install, or right after a reset, there is no
  // database yet, and Expo SQLite rejects the deletion of a missing file.
  // "Nothing to delete" is the outcome we want, not an error.
  await deleteDatabase('alice-ark.db');
}

async function deleteDatabase(name: string): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(name);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/not found|does not exist|no such file/i.test(message)) return;
    // A database still open elsewhere cannot be deleted. The seed change
    // must stop here: saving a new phrase over a surviving index would be
    // the wallet A / phrase B bug in another form.
    void addDiagnosticLog('error', `Local database ${name} was not deleted`, message).catch(() => {});
    throw new Error(`The previous wallet's local data could not be removed (${name}). Close and reopen Alice, then try again.`, { cause });
  }
}

/** The Satora swap records, which belong to one seed and mean nothing to the next. */
export async function clearLocalSwapRepository(): Promise<void> {
  await deleteDatabase('alice-swaps.db');
}
