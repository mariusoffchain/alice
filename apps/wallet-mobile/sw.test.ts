import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

describe('wallet service worker', () => {
  it('preserves the encrypted vault cache during application updates', async () => {
    const source = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), 'public', 'sw.js'),
      'utf8',
    );

    assert.match(source, /const VAULT_CACHE_NAME = 'alice-web-vault-data-v1'/);
    assert.match(source, /const ARKADE_CACHE_PREFIX = 'alice-arkade-'/);
    assert.match(source, /!k\.startsWith\(ARKADE_CACHE_PREFIX\)/);
  });
});
