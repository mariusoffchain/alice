// Which Alice build is talking to the proxy.
//
// These two values are the only client-describing metadata Alice sends, and
// both are coarse by design: a platform from a fixed list and an x.y.z
// version. No device model, no OS version, no locale, no timezone, no screen
// size, no user agent — nothing that narrows a request towards an individual.
// The Worker re-validates both against the same allowlist and regex and drops
// anything else, so these headers cannot become a free-text channel.
//
// The logic lives in client-info-format.ts so it can be unit tested; this
// module only wires it to the environment.
//
// See docs/security/admin-dashboard.md.
import { resolveAlicePlatform } from './client-platform';
import {
  buildClientHeaders,
  parseAppVersion,
  type AlicePlatform,
} from './client-info-format';

export type { AlicePlatform };

export function alicePlatform(): AlicePlatform {
  return resolveAlicePlatform();
}

/**
 * Build version, as x.y.z. Set EXPO_PUBLIC_ALICE_APP_VERSION at build time —
 * the same EXPO_PUBLIC_ convention the proxy URL already uses, which both the
 * Expo and Next builds inline.
 */
export function aliceAppVersion(): string | null {
  return parseAppVersion(process.env.EXPO_PUBLIC_ALICE_APP_VERSION);
}

/** The client-info headers to attach to any authenticated proxy request. */
export function aliceClientHeaders(): Record<string, string> {
  return buildClientHeaders(
    alicePlatform(),
    process.env.EXPO_PUBLIC_ALICE_APP_VERSION,
  );
}
