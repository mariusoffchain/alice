// Aggregate product analytics client.
//
// What this deliberately is NOT: a per-user event stream. The Worker stores
// only day-resolution counters keyed by (day, event, platform, version), with
// no user id, no session id and no ordering, so nothing here can build a
// behavioural profile, no matter how it is called.
//
// The event name list below mirrors ALLOWED_EVENT_NAMES in the Worker's
// admin.ts, which is the real gate: anything not on the server's list is
// discarded on ingest. Keeping a typed copy here just means a typo fails at
// compile time instead of vanishing silently at runtime.
//
// See docs/security/admin-dashboard.md.
import { getValidAccessToken, getInstallId } from './account-client';
import { aliceClientHeaders } from './client-info';

export const ALICE_PRODUCT_EVENTS = [
  'app_opened',
  'app_installed',
  'download_started',
  'download_completed',
  'chat_opened',
  'settings_opened',
  'learning_profile_opened',
  'onboarding_started',
  'onboarding_completed',
  'account_screen_opened',
  'promo_redeemed',
  'cloud_quota_banner_shown',
] as const;

export type AliceProductEvent = typeof ALICE_PRODUCT_EVENTS[number];

/** Flush at most this often, so a burst of UI events is one request. */
const FLUSH_DELAY_MS = 10_000;
/** The Worker rejects a batch larger than this. */
const MAX_BATCH = 32;

let queue: AliceProductEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;

/**
 * Turn analytics off entirely for this process. Alice ships privacy-first,
 * so a user-facing opt-out must be able to stop this at the source rather
 * than rely on the server discarding what it receives.
 */
export function setProductEventsEnabled(value: boolean): void {
  enabled = value;
  if (!enabled) {
    queue = [];
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
}

function proxyRoot(): string | null {
  const configured = (process.env.EXPO_PUBLIC_VENICE_PROXY_URL ?? '').trim();
  if (!configured) return null;
  return configured.replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
}

export async function flushProductEvents(): Promise<void> {
  if (!enabled || queue.length === 0) return;
  const root = proxyRoot();
  if (!root) {
    queue = [];
    return;
  }
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);

  try {
    // Analytics must never block or break a user action, and must never
    // create an account: if there is no session yet, the batch is dropped.
    const accessToken = await getValidAccessToken();
    await fetch(`${root}/account/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Alice-Install-Id': await getInstallId(),
        ...aliceClientHeaders(),
      },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // Dropped on purpose. A counter is not worth a retry queue, and
    // retrying would only make a failing network worse.
  }
}

/**
 * Record one product event. Returns immediately, the batch is sent later
 * and failures are swallowed, so a caller never has to await or handle this.
 */
export function trackProductEvent(event: AliceProductEvent): void {
  if (!enabled) return;
  if (queue.length >= MAX_BATCH * 4) return;
  queue.push(event);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushProductEvents();
  }, FLUSH_DELAY_MS);
}
