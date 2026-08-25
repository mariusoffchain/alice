import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAutoStartSemanticDownload,
  parseSemanticSearchPreference,
} from './semantic-policy.ts';

describe('semantic search download policy', () => {
  it('defaults every unknown or absent preference to auto', () => {
    assert.equal(parseSemanticSearchPreference(null), 'auto');
    assert.equal(parseSemanticSearchPreference(undefined), 'auto');
    assert.equal(parseSemanticSearchPreference('auto'), 'auto');
    // A corrupted value must not strand the user in a silent 'off'.
    assert.equal(parseSemanticSearchPreference('banana'), 'auto');
  });

  it('honours an explicit off', () => {
    assert.equal(parseSemanticSearchPreference('off'), 'off');
  });

  it('auto-starts only when allowed AND the connection is not data-saving', () => {
    assert.equal(canAutoStartSemanticDownload('auto', false), true);
    assert.equal(canAutoStartSemanticDownload('auto', true), false);
    assert.equal(canAutoStartSemanticDownload('off', false), false);
    assert.equal(canAutoStartSemanticDownload('off', true), false);
  });
});
