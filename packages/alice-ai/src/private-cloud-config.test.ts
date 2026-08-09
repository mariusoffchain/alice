import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('disabled Private Cloud fails closed before a transport can be used', () => {
  const moduleUrl = new URL('./private-cloud-config.ts', import.meta.url).href;
  const script = `
    const { assertPrivateCloudEnabled, PRIVATE_CLOUD_ENABLED } =
      await import(${JSON.stringify(moduleUrl)});
    console.log(String(PRIVATE_CLOUD_ENABLED));
    try {
      assertPrivateCloudEnabled();
    } catch (error) {
      console.log(error.message);
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPO_PUBLIC_PRIVATE_CLOUD_ENABLED: 'false',
      EXPO_PUBLIC_VENICE_PROXY_URL: 'https://proxy.must-not-be-used.test/api/v1',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^false/m);
  assert.match(result.stdout, /Private Cloud is unavailable in this beta build/);
});
