import { fetch } from 'expo/fetch';
import { randomBytes } from '@noble/hashes/utils.js';
import {
  deleteAccountSessionValue,
  readAccountSessionValue,
  writeAccountSessionValue,
} from './account-session-storage';
import { aliceClientHeaders } from './client-info';

const SESSION_KEY = 'alice_account_session_v1';
const INSTALL_ID_KEY = 'alice_install_id_v1';
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
  deep_research_credits: number;
  has_password: boolean;
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

export async function verifyEmailLogin(email: string, code: string): Promise<VerifiedSession> {
  const result = await api<VerifiedSession>('/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
  await saveAccountSession(result);
  return result;
}

export type UsernameSuggestion = {
  username: string;
  prefix: string;
  suffix: string;
};

export async function suggestAccountUsernames(
  prefix: string,
  displayName?: string,
): Promise<{ display_name: string; suggestions: UsernameSuggestion[] }> {
  return api('/auth/username/suggestions', {
    method: 'POST',
    body: JSON.stringify({ prefix, display_name: displayName }),
  });
}

export async function registerWithPassword(input: {
  prefix: string;
  suffix: string;
  username?: string;
  display_name?: string;
  password: string;
}): Promise<VerifiedSession> {
  return persistVerifiedSession(await api<VerifiedSession>('/auth/password/register', {
    method: 'POST',
    body: JSON.stringify(input),
  }));
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
  await saveAccountSession(result);
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
  await saveAccountSession(created);
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
  await saveAccountSession(rotated);
  return rotated;
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
    refreshPromise = rotateSession(session)
      .catch(async () => {
        // Private Cloud must remain usable without a visible account. If the
        // technical session cannot be refreshed, recreate it silently from the
        // installation identifier instead of sending the user to sign-in.
        await clearAccountSession();
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
