import type { SQLExecutor } from '@arkade-os/sdk/repositories/sqlite';
import type { SatoraKeyValueStore } from './satora-storage.ts';

const TABLE_NAME = 'alice_satora_recovery';

class SqliteSatoraKeyValueStore implements SatoraKeyValueStore {
  private readonly ready: Promise<void>;
  private readonly executor: SQLExecutor;

  constructor(executor: SQLExecutor) {
    this.executor = executor;
    this.ready = executor.run(
      `CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )`,
    );
  }

  async get(key: string): Promise<string | null> {
    await this.ready;
    const row = await this.executor.get(
      `SELECT value FROM ${TABLE_NAME} WHERE key = ?`,
      [key],
    ) as { value?: unknown } | undefined;
    return typeof row?.value === 'string' ? row.value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.ready;
    await this.executor.run(
      `INSERT OR REPLACE INTO ${TABLE_NAME} (key, value) VALUES (?, ?)`,
      [key, value],
    );
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    await this.executor.run(`DELETE FROM ${TABLE_NAME} WHERE key = ?`, [key]);
  }

  async keys(): Promise<string[]> {
    await this.ready;
    const rows = await this.executor.all(
      `SELECT key FROM ${TABLE_NAME} ORDER BY key ASC`,
    ) as Array<{ key?: unknown }>;
    return rows
      .map(row => row.key)
      .filter((key): key is string => typeof key === 'string');
  }
}

export function createSatoraKeyValueStore(
  executor: SQLExecutor,
): SatoraKeyValueStore {
  return new SqliteSatoraKeyValueStore(executor);
}
