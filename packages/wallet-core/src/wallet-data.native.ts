import * as SQLite from 'expo-sqlite';

export async function clearLocalWalletRepository(): Promise<void> {
  await SQLite.deleteDatabaseAsync('alice-ark.db');
}
