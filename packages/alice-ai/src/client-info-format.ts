// Pure client-info formatting. No imports on purpose: this is the piece
// worth unit testing, and every tested module in this package is a leaf so
// it can run under `node --test` without a bundler.

/**
 * The platforms Alice reports. Must stay in sync with KNOWN_PLATFORMS in the
 * Worker's account.ts, anything not on that server-side list is dropped
 * rather than stored.
 */
export type AlicePlatform =
  | 'ios'
  | 'android'
  | 'web'
  | 'desktop-macos'
  | 'desktop-windows'
  | 'desktop-linux';

/**
 * Accept only a strict x.y.z version. A malformed value is reported as
 * nothing rather than as a guess, so the analytics never invent a version
 * that was never shipped.
 */
export function parseAppVersion(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ? value : null;
}

/**
 * Assemble the client-info headers. Exactly two, both coarse: never a user
 * agent, device model, OS version, locale, timezone or screen size.
 */
export function buildClientHeaders(
  platform: AlicePlatform,
  rawVersion: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { 'X-Alice-Platform': platform };
  const version = parseAppVersion(rawVersion);
  if (version) headers['X-Alice-App-Version'] = version;
  return headers;
}

/** Resolve a Tauri desktop build to a concrete platform from a UA hint. */
export function desktopPlatformFromHint(hint: string): AlicePlatform {
  if (/mac|darwin/i.test(hint)) return 'desktop-macos';
  if (/win/i.test(hint)) return 'desktop-windows';
  if (/linux|x11/i.test(hint)) return 'desktop-linux';
  // A Tauri webview we cannot place is still a desktop build, but reporting
  // it as Linux would be a guess. Fall back to the honest generic value.
  return 'web';
}
