import assert from 'node:assert/strict';
import test from 'node:test';
import { getAIDisabledMessage } from './ai-availability.ts';

const allEnabled = { local: true, cloud: true, custom: true };

test('global Alice control blocks every backend', () => {
  for (const backend of ['local', 'cloud', 'custom'] as const) {
    assert.match(getAIDisabledMessage(false, backend, allEnabled) ?? '', /Alice AI is disabled/);
  }
});

test('each backend fails closed independently', () => {
  for (const backend of ['local', 'cloud', 'custom'] as const) {
    const state = { ...allEnabled, [backend]: false };
    assert.match(getAIDisabledMessage(true, backend, state) ?? '', /AI is disabled/);
    const other = backend === 'local' ? 'cloud' : 'local';
    assert.equal(getAIDisabledMessage(true, other, state), null);
  }
});
