import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildClientHeaders,
  desktopPlatformFromHint,
  parseAppVersion,
} from './client-info-format.ts';

describe('parseAppVersion', () => {
  it('accepts an x.y.z version', () => {
    assert.equal(parseAppVersion('1.4.2'), '1.4.2');
    assert.equal(parseAppVersion('  1.4.2  '), '1.4.2');
    assert.equal(parseAppVersion('10.0.100'), '10.0.100');
  });

  it('reports nothing rather than guessing when the value is malformed', () => {
    for (const bad of ['', 'v1.4.2', '1.4', 'latest', '1.4.2-beta', '   ', undefined]) {
      assert.equal(parseAppVersion(bad), null, `${bad} must not be reported`);
    }
  });

  it('refuses a value long enough to smuggle content', () => {
    assert.equal(parseAppVersion('1.4.2 (build from marius@example.com)'), null);
    assert.equal(parseAppVersion('1111.1.1'), null);
  });
});

describe('buildClientHeaders', () => {
  it('sends exactly two coarse headers and nothing else', () => {
    // The whole point of this module: never a user agent, device model,
    // locale, timezone or screen size.
    assert.deepEqual(
      Object.keys(buildClientHeaders('ios', '1.4.2')).sort(),
      ['X-Alice-App-Version', 'X-Alice-Platform'],
    );
  });

  it('omits the version header entirely when there is no valid version', () => {
    const headers = buildClientHeaders('android', 'not-a-version');
    assert.deepEqual(Object.keys(headers), ['X-Alice-Platform']);
    assert.equal(headers['X-Alice-Platform'], 'android');
  });
});

describe('desktopPlatformFromHint', () => {
  it('places the common desktop builds', () => {
    assert.equal(desktopPlatformFromHint('Mozilla/5.0 (Macintosh; Intel Mac OS X)'), 'desktop-macos');
    assert.equal(desktopPlatformFromHint('Mozilla/5.0 (Windows NT 10.0) Win32'), 'desktop-windows');
    assert.equal(desktopPlatformFromHint('Mozilla/5.0 (X11; Linux x86_64)'), 'desktop-linux');
  });

  it('falls back to the generic value rather than guessing', () => {
    assert.equal(desktopPlatformFromHint(''), 'web');
    assert.equal(desktopPlatformFromHint('something unrecognisable'), 'web');
  });
});
