import { fetch } from 'expo/fetch';
import { randomBytes } from '@noble/hashes/utils.js';
import {
  deleteAccountSessionValue,
  readAccountSessionValue,
  writeAccountSessionValue,
} from './account-session-storage';
import { aliceClientHeaders } from './client-info';
import {
  PENDING_CHECKOUT_TTL_MS,
  type AlicePendingCheckout,
} from './billing-checkout';

const SESSION_KEY = 'alice_account_session_v1';
const INSTALL_ID_KEY = 'alice_install_id_v1';
const PENDING_CHECKOUT_KEY = 'alice_pending_checkout_v1';
const ACCESS_REFRESH_MARGIN_MS = 30_000;

async function readSessionValue(): Promise<string | null> {
  return readAccountSessionValue(SESSION_KEY);
}

async function writeSessionValue(value: string): Promise<void> {
  await writeAccountSessionValue(SESSION_KEY, value);
}

async function deleteSessionValue(): Promise<void> {
  await deleteAccountSessionValue(SESSION_KEY);
}

export type AliceAccount = {
  user_id: string;
  is_anonymous: boolean;
  status: string;
  username: string | null;
  display_name: string | null;
  email_masked: string | null;
  plan: string;
  cloud_enabled: boolean;
  cloud_requests_limit: number;
  cloud_requests_used: number;
  cloud_requests_remaining: number;
  has_password: boolean;
  /**
   * Whether Alice holds an address she can actually write to, as opposed to
   * only the one-way lookup that signs the account in. Screens use it to say
   * plainly whether an expiring plan can be announced at all.
   */
  email_reachable: boolean;
  /** Non-essential mail. Expiry warnings do not depend on it. */
  product_updates: boolean;
  identities: AliceAccountIdentity[];
};

export type AliceAccountIdentity = {
  id: string;
  provider: 'email' | 'password';
  display_label: string;
  created_at: number;
  last_used_at: number;
};

export type AliceAccountSession = {
  access_token: string;
  access_expires_at: number;
  refresh_token: string;
  refresh_expires_at: number;
  // Whether this session belongs to a signed-in person rather than to the
  // installation. The distinction decides what a failed refresh may do: an
  // anonymous session can be recreated silently because the install id leads
  // back to the same anonymous account, but a person's session recreated that
  // way would replace them with a stranger and never say so. Absent on
  // sessions stored before the field existed, which reads as anonymous: the
  // silent path is only safe there, and a signed-in person from that era
  // signs in again once, gaining the flag.
  identified?: boolean;
};

type VerifiedSession = AliceAccountSession & {
  account: AliceAccount;
};

export class AliceAccountError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'AliceAccountError';
    this.code = code;
    this.status = status;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  let index = 0;
  while (index + 2 < bytes.length) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    output += alphabet[(value >>> 6) & 63];
    output += alphabet[value & 63];
    index += 3;
  }
  if (index < bytes.length) {
    let value = bytes[index] << 16;
    if (index + 1 < bytes.length) value |= bytes[index + 1] << 8;
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    if (index + 1 < bytes.length) output += alphabet[(value >>> 6) & 63];
  }
  return output;
}

function randomId(bytes = 18): string {
  return bytesToBase64Url(randomBytes(bytes));
}

export function createPrivateCloudRequestId(): string {
  return `req_${randomId(18)}`;
}

function proxyRoot(): string {
  const configured = (process.env.EXPO_PUBLIC_VENICE_PROXY_URL ?? '').trim();
  if (!configured) {
    throw new AliceAccountError(
      'account_not_configured',
      'Alice accounts are not configured in this build.',
    );
  }
  return configured
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/i, '');
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  let code = 'account_request_failed';
  let message = 'Alice could not complete this account request.';
  try {
    const body = await response.json() as {
      error?: { code?: string; message?: string } | string;
    };
    if (body.error && typeof body.error === 'object') {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    } else if (typeof body.error === 'string') {
      message = body.error;
    }
  } catch {}
  throw new AliceAccountError(code, message, response.status);
}

async function api<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  headers.set('X-Alice-Install-Id', await getInstallId());
  for (const [name, value] of Object.entries(aliceClientHeaders())) {
    headers.set(name, value);
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${proxyRoot()}${path}`, { ...init, headers } as any) as Response;
  } catch (error) {
    throw new AliceAccountError(
      'network',
      error instanceof Error && error.message ? error.message : 'Network request failed.',
    );
  }
  return parseResponse<T>(response);
}

export async function getInstallId(): Promise<string> {
  const current = await readAccountSessionValue(INSTALL_ID_KEY);
  if (current && /^[A-Za-z0-9_-]{16,128}$/.test(current)) return current;
  const created = `alice_${randomId(18)}`;
  await writeAccountSessionValue(INSTALL_ID_KEY, created);
  return created;
}

export async function loadAccountSession(): Promise<AliceAccountSession | null> {
  const raw = await readSessionValue();
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as AliceAccountSession;
    if (
      typeof session.access_token !== 'string'
      || typeof session.refresh_token !== 'string'
      || typeof session.access_expires_at !== 'number'
      || typeof session.refresh_expires_at !== 'number'
    ) {
      throw new Error('Invalid session');
    }
    return session;
  } catch {
    await deleteSessionValue();
    return null;
  }
}

async function saveAccountSession(session: AliceAccountSession): Promise<void> {
  await writeSessionValue(JSON.stringify(session));
}

export async function clearAccountSession(): Promise<void> {
  await deleteSessionValue();
}

export async function startEmailLogin(email: string): Promise<{ retry_after_seconds: number }> {
  return api('/auth/email/start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function verifyEmailLogin(
  email: string,
  code: string,
  newPassword?: string,
): Promise<VerifiedSession> {
  const result = await api<VerifiedSession>('/auth/email/verify', {
    method: 'POST',
    // new_password turns the code into a password reset: the server refuses a
    // bare code for any account that has a password, so for those this field
    // is not an option but the whole point of the call.
    body: JSON.stringify(newPassword ? { email, code, new_password: newPassword } : { email, code }),
  });
  await saveAccountSession({ ...result, identified: true });
  return result;
}

export type UsernameSuggestion = {
  username: string;
  prefix: string;
  suffix: string;
};

/**
 * The middle words and the number, before a name has been typed.
 *
 * Public and unauthenticated, like the suggestions it replaces on the create
 * screen: someone choosing a username does not have an account yet.
 */
export async function getUsernameVocabulary(): Promise<{
  suffixes: string[];
  discriminator: string;
}> {
  return api('/auth/username/vocabulary', { method: 'GET' });
}

export async function suggestAccountUsernames(
  prefix: string,
  displayName?: string,
  options: { all?: boolean } = {},
): Promise<{ display_name: string; suggestions: UsernameSuggestion[] }> {
  return api('/auth/username/suggestions', {
    method: 'POST',
    body: JSON.stringify({ prefix, display_name: displayName, all: options.all }),
  });
}


export async function loginWithPassword(
  identifier: string,
  password: string,
): Promise<VerifiedSession> {
  return persistVerifiedSession(await api<VerifiedSession>('/auth/password/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  }));
}

export async function setPassword(input: {
  password: string;
  prefix?: string;
  suffix?: string;
  username?: string;
  display_name?: string;
}): Promise<AliceAccount> {
  const result = await api<{ account: AliceAccount }>('/account/password', {
    method: 'PUT',
    body: JSON.stringify(input),
  }, await getValidAccessToken());
  return result.account;
}

export async function updateAccountProfile(input: {
  display_name?: string;
  prefix?: string;
  suffix?: string;
  username?: string;
}): Promise<AliceAccount> {
  const result = await api<{ account: AliceAccount }>('/account/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  }, await getValidAccessToken());
  return result.account;
}

async function persistVerifiedSession(result: VerifiedSession): Promise<VerifiedSession> {
  await saveAccountSession({ ...result, identified: true });
  return result;
}

export async function startEmailIdentityLink(
  email: string,
): Promise<{ retry_after_seconds: number }> {
  return api('/account/identities/email/start', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }, await getValidAccessToken());
}

export async function verifyEmailIdentityLink(
  email: string,
  code: string,
): Promise<AliceAccount> {
  const result = await api<{ account: AliceAccount }>(
    '/account/identities/email/verify',
    {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    },
    await getValidAccessToken(),
  );
  return result.account;
}

export async function revokeAccountIdentity(identityId: string): Promise<AliceAccount> {
  return api('/account/identities/revoke', {
    method: 'POST',
    body: JSON.stringify({ identity_id: identityId }),
  }, await getValidAccessToken());
}

let refreshPromise: Promise<AliceAccountSession> | null = null;

export async function ensureAnonymousAccountSession(): Promise<AliceAccountSession> {
  const current = await loadAccountSession();
  if (current) return current;
  const created = await api<AliceAccountSession>('/auth/anonymous', {
    method: 'POST',
    body: '{}',
  });
  await saveAccountSession({ ...created, identified: false });
  return created;
}

async function rotateSession(session: AliceAccountSession): Promise<AliceAccountSession> {
  if (session.refresh_expires_at <= Date.now()) {
    await clearAccountSession();
    throw new AliceAccountError('session_expired', 'Your Alice session has expired.', 401);
  }
  const rotated = await api<AliceAccountSession>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  await saveAccountSession({ ...rotated, identified: session.identified });
  return { ...rotated, identified: session.identified };
}

export async function getValidAccessToken(): Promise<string> {
  let session = await loadAccountSession();
  if (!session) {
    session = await ensureAnonymousAccountSession();
  }
  if (session.access_expires_at > Date.now() + ACCESS_REFRESH_MARGIN_MS) {
    return session.access_token;
  }
  if (!refreshPromise) {
    const wasIdentified = session.identified === true;
    refreshPromise = rotateSession(session)
      .catch(async () => {
        await clearAccountSession();
        if (wasIdentified) {
          // This session belonged to a person. Recreating it silently from
          // the install id, the way anonymous sessions heal, would sign them
          // into a fresh anonymous account without a word: their plan and
          // username intact on the server, and this device suddenly claiming
          // they have neither. Watched happen: one tab refreshed, the other
          // tab's token became stale, and a paying account turned into
          // "free, no username" on screen. Being told to sign in again is an
          // annoyance; being quietly swapped for a stranger is a betrayal.
          throw new AliceAccountError('session_expired', 'Your Alice session has expired.', 401);
        }
        // Private Cloud must remain usable without a visible account. An
        // anonymous session leads back to the same anonymous user through
        // the installation identifier, so recreating it loses nothing.
        return ensureAnonymousAccountSession();
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  session = await refreshPromise;
  return session.access_token;
}

export async function getAccount(): Promise<AliceAccount> {
  return api('/account', { method: 'GET' }, await getValidAccessToken());
}

export async function logoutAccount(): Promise<void> {
  try {
    const session = await loadAccountSession();
    if (session) {
      await api('/auth/logout', { method: 'POST' }, session.access_token);
    }
  } finally {
    await clearAccountSession();
  }
}

export async function requestAccountDeletion(): Promise<void> {
  await api(
    '/account/deletion-request',
    { method: 'POST' },
    await getValidAccessToken(),
  );
  await clearAccountSession();
}

export async function privateCloudAccountHeaders(requestIdentifier?: string): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getValidAccessToken()}`,
    'X-Alice-Install-Id': await getInstallId(),
    'X-Alice-Request-Id': requestIdentifier ?? createPrivateCloudRequestId(),
    ...aliceClientHeaders(),
  };
}

/**
 * Redeem a promo code for extra free Private Cloud requests. The server
 * decides how many; the client only reports the resulting account state.
 */
export async function redeemPromoCode(code: string): Promise<AliceAccount> {
  const body = await api<{ account: AliceAccount }>(
    '/account/promo/redeem',
    { method: 'POST', body: JSON.stringify({ code }) },
    await getValidAccessToken(),
  );
  return body.account;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export type AlicePaidPlan = 'cloud';
export type AlicePlan = 'free' | AlicePaidPlan;

/**
 * Mirror of the Worker's billing snapshot.
 *
 * `usage_percent` is an estimate, not a measurement: messages are end-to-end
 * encrypted, so the server cannot count tokens and meters the bytes passing
 * through instead. Screens that show it must say so, and must never derive a
 * precise token figure from the byte fields.
 */
export type AliceBilling = {
  /** The plan in force right now, once expiry is taken into account. */
  plan: AlicePlan;
  /** What was bought, even if it has since lapsed. */
  purchased_plan: AlicePlan;
  plan_expires_at: number | null;
  expired: boolean;
  period_started_at: number | null;
  period_ends_at: number | null;
  usage_percent: number | null;
  input_bytes_used: number;
  input_bytes_limit: number;
  output_bytes_used: number;
  output_bytes_limit: number;
  billing_email_masked: string | null;
};

export type AliceCheckout = {
  invoice_id: string;
  checkout_url: string;
  plan: AlicePaidPlan;
  months: number;
  amount_sats: number;
  currency: 'SAT';
};

/**
 * The price list, quoted in satoshis.
 *
 * The plans are anchored to a fiat amount server-side so they keep covering
 * what the models cost, but that anchor is never shown: a buyer sees satoshis
 * and pays satoshis. `price_sats` is null while the server has no exchange
 * rate, which is the one case where nothing can honestly be quoted.
 */
export type AlicePlanQuote = {
  plan: AlicePaidPlan;
  price_sats: number | null;
  /**
   * The anchor, in minor units. A landmark to print under the satoshi price,
   * never a second price: the satoshi figure is what gets charged, and the two
   * stop agreeing to the cent as soon as rounding and the rate are involved.
   */
  price_minor: number;
};

export type AlicePlanQuotes = {
  currency: 'SAT';
  /** ISO code of the anchor the `price_minor` figures are expressed in. */
  anchor_currency: string;
  /** The rounding step every quote lands on. */
  step_sats: number;
  quoted_at: number | null;
  plans: AlicePlanQuote[];
};

/** Public: someone deciding whether to buy has not signed in yet. */
export async function getPlanQuotes(): Promise<AlicePlanQuotes> {
  return api('/billing/plans', { method: 'GET' });
}

export async function loadPendingCheckout(): Promise<AlicePendingCheckout | null> {
  const raw = await readAccountSessionValue(PENDING_CHECKOUT_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as AlicePendingCheckout;
    if (typeof pending.invoice_id !== 'string' || typeof pending.started_at !== 'number') {
      throw new Error('Invalid pending checkout');
    }
    if (Date.now() - pending.started_at > PENDING_CHECKOUT_TTL_MS) {
      await clearPendingCheckout();
      return null;
    }
    return pending;
  } catch {
    await clearPendingCheckout();
    return null;
  }
}

export async function savePendingCheckout(pending: AlicePendingCheckout): Promise<void> {
  await writeAccountSessionValue(PENDING_CHECKOUT_KEY, JSON.stringify(pending));
}

export async function clearPendingCheckout(): Promise<void> {
  await deleteAccountSessionValue(PENDING_CHECKOUT_KEY);
}

export async function getBilling(): Promise<AliceBilling> {
  return api('/billing', { method: 'GET' }, await getValidAccessToken());
}

/**
 * Ask the server for a BTCPay invoice. Nothing changes on the account until
 * the payment settles and the signed webhook credits it server-side; the
 * client's only job afterwards is to poll `getBilling` while waiting.
 */
export async function startPlanCheckout(
  plan: AlicePaidPlan,
  months: number,
): Promise<AliceCheckout> {
  return api('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan, months }),
  }, await getValidAccessToken());
}

/**
 * Choose whether Alice may send anything beyond the essentials.
 *
 * There is no call to set the address itself: it is whichever address signs
 * the account in, proved by a code, which is what keeps "who owns this
 * account" and "where Alice writes" from drifting apart. Changing it goes
 * through the same verification as adding any other way in.
 */
export async function setProductUpdates(enabled: boolean): Promise<AliceAccount> {
  return api('/account/email/preferences', {
    method: 'PUT',
    body: JSON.stringify({ product_updates: enabled }),
  }, await getValidAccessToken());
}
