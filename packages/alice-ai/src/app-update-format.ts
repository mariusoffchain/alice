// Pure decisions for the update banner and the what's-new dialog. No DOM, no
// storage, no fetch: the wiring lives in app-update.ts so this part can be
// unit tested the way client-info-format.ts is.

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/** True when `latest` is a well-formed version strictly newer than `current`. */
export function isNewerVersion(latest: unknown, current: unknown): boolean {
  if (typeof latest !== 'string' || !VERSION_RE.test(latest)) return false;
  if (typeof current !== 'string' || !VERSION_RE.test(current)) return false;
  const a = latest.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export type WhatsNewDecision =
  // First run ever on this device: a fresh install is not an update, showing
  // "what's new" would greet a newcomer with a diff against nothing.
  | 'record-only'
  // The build changed since last seen: show the dialog once.
  | 'show'
  | 'up-to-date';

export function decideWhatsNew(
  currentVersion: string | null,
  lastSeenVersion: string | null,
): WhatsNewDecision {
  if (!currentVersion) return 'up-to-date';
  if (!lastSeenVersion) return 'record-only';
  return lastSeenVersion === currentVersion ? 'up-to-date' : 'show';
}

/** Update checks are polite: at most one network request per interval. */
export function isCheckDue(lastCheckedAtMs: number | null, nowMs: number, minIntervalMs: number): boolean {
  if (lastCheckedAtMs === null || !Number.isFinite(lastCheckedAtMs)) return true;
  return nowMs - lastCheckedAtMs >= minIntervalMs;
}
