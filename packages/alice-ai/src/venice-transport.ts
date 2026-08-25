// Decides how a Venice call is allowed to leave this device.
//
// Pure and testable on purpose: this is where the "the browser never holds the
// Venice key" rule lives, and it should be provable without a network or a
// bundler.

export const VENICE_DIRECT_BASE = 'https://api.venice.ai/api/v1';

export class VeniceTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VeniceTransportError';
  }
}

/**
 * Venice names its encrypted models `e2ee-*`. Selecting one is what commits us
 * to the E2EE protocol, there is no plaintext path for these models.
 */
export function isE2EEModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('e2ee-');
}

export type TransportInputs = {
  /** Alice's blind proxy, e.g. https://proxy.alicebtc.com/api/v1 */
  proxyUrl?: string;
  /** Only present during explicit internal diagnostics, never a release build. */
  apiKey?: string;
  /**
   * True for a publicly hosted web build. Such a build must never carry the
   * Venice key, so it can only talk to Venice through the proxy.
   */
  isPublicWeb: boolean;
};

export type ResolvedTransport = {
  baseUrl: string;
  authorization?: string;
  viaProxy: boolean;
};

/**
 * Resolve the transport, or refuse.
 *
 * The proxy is always preferred when configured. A public web build with no
 * proxy is a hard error: falling back to a bundled key would publish it, and
 * falling back to plaintext would break the encryption promise. Both are
 * refusals, never silent downgrades.
 */
export function resolveVeniceTransport(inputs: TransportInputs): ResolvedTransport {
  const proxyUrl = inputs.proxyUrl?.trim();
  if (proxyUrl) {
    const root = proxyUrl.replace(/\/+$/, '');
    const baseUrl = /\/api\/v1$/i.test(root) ? root : `${root}/api/v1`;
    // The proxy attaches the key itself; the client must not send one.
    return { baseUrl, viaProxy: true };
  }

  if (inputs.isPublicWeb) {
    throw new VeniceTransportError(
      'Private Cloud is not available in this web build: no proxy is configured, and the web app must not carry a Venice API key.',
    );
  }

  const apiKey = inputs.apiKey?.trim();
  if (!apiKey) {
    throw new VeniceTransportError(
      'Private Cloud is not configured yet. Add a Venice API key to use cloud answers.',
    );
  }

  return { baseUrl: VENICE_DIRECT_BASE, authorization: `Bearer ${apiKey}`, viaProxy: false };
}
