import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VENICE_DIRECT_BASE,
  VeniceTransportError,
  isE2EEModel,
  resolveVeniceTransport,
} from './venice-transport.ts';

describe('isE2EEModel', () => {
  it('recognises the e2ee- prefix', () => {
    assert.equal(isE2EEModel('e2ee-gpt-oss-120b-p'), true);
    assert.equal(isE2EEModel('e2ee-glm-5-2-p'), true);
    assert.equal(isE2EEModel('E2EE-Something'), true);
    assert.equal(isE2EEModel('  e2ee-x  '), true);
  });

  it('does not match ordinary models', () => {
    assert.equal(isE2EEModel('llama-3.3-70b'), false);
    assert.equal(isE2EEModel('gpt-oss-120b'), false);
    assert.equal(isE2EEModel(''), false);
    // Substring elsewhere must not count.
    assert.equal(isE2EEModel('my-e2ee-model'), false);
  });
});

describe('resolveVeniceTransport', () => {
  it('prefers the proxy and sends no Authorization with it', () => {
    const t = resolveVeniceTransport({
      proxyUrl: 'https://proxy.alice.test/api/v1',
      apiKey: 'should-be-ignored',
      isPublicWeb: true,
    });
    assert.equal(t.baseUrl, 'https://proxy.alice.test/api/v1');
    assert.equal(t.viaProxy, true);
    assert.equal(t.authorization, undefined, 'the proxy attaches the key, not the client');
  });

  it('trims a trailing slash off the proxy URL', () => {
    const t = resolveVeniceTransport({ proxyUrl: 'https://proxy.test/api/v1/', isPublicWeb: true });
    assert.equal(t.baseUrl, 'https://proxy.test/api/v1');
  });

  it('adds the Worker API prefix when given its public root URL', () => {
    const t = resolveVeniceTransport({ proxyUrl: 'https://proxy.test/', isPublicWeb: true });
    assert.equal(t.baseUrl, 'https://proxy.test/api/v1');
  });

  // The core rule of this module.
  it('refuses a public web build with no proxy, even if a key is present', () => {
    assert.throws(
      () => resolveVeniceTransport({ apiKey: 'leaked-key', isPublicWeb: true }),
      VeniceTransportError,
    );
  });

  it('never returns a bundled key to a public web build', () => {
    try {
      resolveVeniceTransport({ apiKey: 'leaked-key', isPublicWeb: true });
      assert.fail('should have refused');
    } catch (err) {
      assert.ok(err instanceof VeniceTransportError);
      assert.ok(!(err as Error).message.includes('leaked-key'));
    }
  });

  it('allows a direct call with a key off the public web (desktop, mobile)', () => {
    const t = resolveVeniceTransport({ apiKey: 'local-key', isPublicWeb: false });
    assert.equal(t.baseUrl, VENICE_DIRECT_BASE);
    assert.equal(t.authorization, 'Bearer local-key');
    assert.equal(t.viaProxy, false);
  });

  it('refuses when nothing is configured at all', () => {
    assert.throws(() => resolveVeniceTransport({ isPublicWeb: false }), VeniceTransportError);
    assert.throws(() => resolveVeniceTransport({ apiKey: '   ', isPublicWeb: false }), VeniceTransportError);
  });

  it('treats an empty proxy URL as unset', () => {
    assert.throws(() => resolveVeniceTransport({ proxyUrl: '  ', isPublicWeb: true }), VeniceTransportError);
  });
});
