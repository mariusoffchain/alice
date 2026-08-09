import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as SQLite from 'expo-sqlite';
import type { SQLExecutor } from '@arkade-os/sdk/repositories/sqlite';
import {
  SQLiteContractRepository,
  SQLiteWalletRepository,
} from '@arkade-os/sdk/repositories/sqlite';
import { AsyncStorageTaskQueue } from '@arkade-os/sdk/worker/expo';
import {
  defineExpoBackgroundTask,
} from '@arkade-os/sdk/wallet/expo/background';

export const ARKADE_BACKGROUND_TASK_NAME = 'alice-arkade-background-sync';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function database(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync('alice-ark.db');
  return databasePromise;
}

const executor: SQLExecutor = {
  run: async (sql, params) => {
    await (await database()).runAsync(sql, (params ?? []) as any[]);
  },
  get: async (sql, params) =>
    (await database()).getFirstAsync(sql, (params ?? []) as any[]) as Promise<any>,
  all: async (sql, params) =>
    (await database()).getAllAsync(sql, (params ?? []) as any[]) as Promise<any>,
};

const taskQueue = new AsyncStorageTaskQueue(AsyncStorage);

defineExpoBackgroundTask(ARKADE_BACKGROUND_TASK_NAME, {
  taskQueue,
  walletRepository: new SQLiteWalletRepository(executor),
  contractRepository: new SQLiteContractRepository(executor),
});

export async function registerArkadeBackgroundSync(): Promise<boolean> {
  await BackgroundTask.registerTaskAsync(ARKADE_BACKGROUND_TASK_NAME, {
    minimumInterval: 15,
  });
  return true;
}

export async function unregisterArkadeBackgroundSync(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(ARKADE_BACKGROUND_TASK_NAME);
}

/** Releases SQLite before a user-approved local Arkade index rebuild. */
export async function closeArkadeBackgroundDatabase(): Promise<void> {
  const currentDatabase = databasePromise;
  databasePromise = null;
  if (!currentDatabase) return;
  const db = await currentDatabase.catch(() => null);
  await db?.closeAsync().catch(() => {});
}
