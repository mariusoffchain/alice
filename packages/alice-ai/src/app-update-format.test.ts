import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideWhatsNew, isCheckDue, isNewerVersion } from './app-update-format.ts';

describe('update version comparison', () => {
  it('orders numerically, not lexically', () => {
    assert.equal(isNewerVersion('0.10.0', '0.2.0'), true);
    assert.equal(isNewerVersion('0.2.1', '0.2.0'), true);
    assert.equal(isNewerVersion('1.0.0', '0.9.9'), true);
    assert.equal(isNewerVersion('0.2.0', '0.2.0'), false);
    assert.equal(isNewerVersion('0.1.9', '0.2.0'), false);
  });

  it('treats anything malformed as no update', () => {
    assert.equal(isNewerVersion('banana', '0.2.0'), false);
    assert.equal(isNewerVersion('1.0', '0.2.0'), false);
    assert.equal(isNewerVersion('9.9.9', null), false);
    assert.equal(isNewerVersion(undefined, '0.2.0'), false);
  });
});

describe("what's-new decision", () => {
  it('records silently on a fresh install', () => {
    assert.equal(decideWhatsNew('0.2.0', null), 'record-only');
  });
  it('shows once when the version changed', () => {
    assert.equal(decideWhatsNew('0.2.0', '0.1.0'), 'show');
  });
  it('stays quiet on the same version or without a build version', () => {
    assert.equal(decideWhatsNew('0.2.0', '0.2.0'), 'up-to-date');
    assert.equal(decideWhatsNew(null, '0.1.0'), 'up-to-date');
  });
});

describe('check throttle', () => {
  it('is due with no record, overdue record, or garbage record', () => {
    assert.equal(isCheckDue(null, 1_000_000, 100), true);
    assert.equal(isCheckDue(0, 1_000_000, 100), true);
    assert.equal(isCheckDue(Number.NaN, 1_000_000, 100), true);
  });
  it('is not due inside the interval', () => {
    assert.equal(isCheckDue(950, 1_000, 100), false);
  });
});
