import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chooseInitialBackend,
  fallbackAfterBackendDisabled,
} from './ai-mode-routing.ts';

const base = {
  storedBackend: null,
  privateCloudEnabled: true,
  enabled: { local: true, cloud: true, custom: true },
  localAvailable: false,
  customConfigured: false,
  preferLocal: false,
};

describe('AI mode routing', () => {
  it('defaults a PWA to Private Cloud', () => {
    assert.equal(chooseInitialBackend(base), 'cloud');
  });

  it('restores Custom only when it is configured and enabled', () => {
    assert.equal(chooseInitialBackend({ ...base, storedBackend: 'custom' }), 'cloud');
    assert.equal(chooseInitialBackend({
      ...base,
      storedBackend: 'custom',
      customConfigured: true,
    }), 'custom');
    assert.equal(chooseInitialBackend({
      ...base,
      storedBackend: 'custom',
      customConfigured: true,
      enabled: { ...base.enabled, custom: false },
    }), 'cloud');
  });

  it('does not restore disabled or unavailable backends', () => {
    assert.equal(chooseInitialBackend({
      ...base,
      storedBackend: 'cloud',
      enabled: { ...base.enabled, cloud: false },
    }), 'custom');
    assert.equal(chooseInitialBackend({
      ...base,
      storedBackend: 'local',
      privateCloudEnabled: false,
      localAvailable: false,
    }), 'custom');
  });

  it('prefers Local on desktop when available', () => {
    assert.equal(chooseInitialBackend({ ...base, localAvailable: true, preferLocal: true }), 'local');
  });

  it('falls back to an enabled backend when the active one is disabled', () => {
    assert.equal(fallbackAfterBackendDisabled({
      disabledBackend: 'cloud',
      privateCloudEnabled: true,
      enabled: { local: true, cloud: false, custom: true },
      localAvailable: true,
    }), 'local');
    assert.equal(fallbackAfterBackendDisabled({
      disabledBackend: 'local',
      privateCloudEnabled: true,
      enabled: { local: false, cloud: true, custom: true },
      localAvailable: true,
    }), 'cloud');
  });
});
