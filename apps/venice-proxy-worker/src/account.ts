import type { Env } from './index.ts';
import { accountEmailMasked, rememberAccountEmail, setProductUpdates } from './account-email.ts';
import { maskEmail } from './email-vault.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const EMAIL_CODE_TTL_MS = 10 * 60 * 1_000;
const CRYPTO_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
const ACCOUNT_CREATION_WINDOW_MS = 24 * 60 * 60 * 1_000;
const EMAIL_RESEND_DELAY_MS = 60 * 1_000;
const EMAIL_SEND_LIMIT = 5;
const IP_SEND_LIMIT = 20;
const IP_ACCOUNT_CREATION_LIMIT = 5;
const VERIFY_LIMIT = 20;
const MAX_CODE_ATTEMPTS = 5;
const FREE_REQUEST_LIMIT = 21;
// 100k, not the 600k OWASP asks of PBKDF2-SHA256, and not by choice: the
// Workers runtime rejects anything above 100_000 outright, and scrypt in
// JavaScript burns more CPU than the free plan's 10ms budget, which made
// sign-in fail with a bare Cloudflare 1102 depending on the day's weather.
// A password hash that sometimes refuses the right password is worse than a
// cheaper hash that always answers. The 15-character minimum is what buys
// the difference back: length is the defence here, not iteration count.
const PASSWORD_ITERATIONS = 100_000;
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const PASSWORD_LOGIN_LIMIT = 10;
const PASSWORD_MIN_LENGTH = 15;
const PASSWORD_MAX_LENGTH = 128;
const USERNAME_CHANGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const USERNAME_RESERVATION_MS = 180 * 24 * 60 * 60 * 1_000;
const USERNAME_SUFFIXES = [
  'cheshire',
  'hatter',
  'wonderland',
  'lookingglass',
  'whiterabbit',
  'goldenkey',
  'teacup',
  'croquet',
  'curiouser',
  'dreamer',
  'dormouse',
  'caterpillar',
  'gryphon',
  'tulgey',
  'frabjous',
] as const;
const RESERVED_USERNAME_PARTS = new Set([
  'admin',
  'administrator',
  'alice',
  'alicebtc',
  'official',
  'security',
  'staff',
  'support',
  'team',
]);
const REVOKED_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const EXPIRED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const ORPHAN_INSTALLATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

type SessionUserRow = {
  session_id: string;
  user_id: string;
  status: string;
  access_expires_at: number;
};

type AccountRow = {
  user_id: string;
  status: string;
  username: string | null;
  display_name: string | null;
  email_masked: string | null;
  plan: string;
  cloud_enabled: number;
  free_cloud_requests_limit: number;
  free_cloud_requests_used: number;
};

export type AccountIdentity = {
  id: string;
  provider: 'email' | 'password';
  display_label: string;
  created_at: number;
  last_used_at: number;
};

export type AuthenticatedUser = {
  sessionId: string;
  userId: string;
};

export type AccountSnapshot = {
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
   * Whether Alice actually holds a reachable address for this account, as
   * opposed to only the one-way lookup that signs it in. Screens use it to say
   * plainly whether a plan running out can be announced at all.
   */
  email_reachable: boolean;
  /** Non-essential mail. Transactional mail does not depend on it. */
  product_updates: boolean;
  identities: AccountIdentity[];
};

export type QuotaReservation = {
  ledgerId: string;
  remaining: number;
  used: number;
  limit: number;
  duplicate: boolean;
};

export class AccountHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AccountHttpError';
    this.status = status;
    this.code = code;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string, expectedBytes: number): Uint8Array {
  if (!new RegExp(`^[0-9a-fA-F]{${expectedBytes * 2}}$`).test(value)) {
    throw new AccountHttpError(400, 'invalid_key', 'Invalid public key or signature.');
  }
  return Uint8Array.from(
    { length: expectedBytes },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

function randomCode(): string {
  const max = 0x1_0000_0000;
  const ceiling = max - (max % 1_000_000);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= ceiling);
  return String(value[0] % 1_000_000).padStart(6, '0');
}

function randomUint32(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function hmac(env: Env, value: string): Promise<string> {
  if (!env.AUTH_HMAC_KEY || env.AUTH_HMAC_KEY.length < 32) {
    throw new AccountHttpError(500, 'auth_not_configured', 'Account authentication is not configured.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.AUTH_HMAC_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string') {
    throw new AccountHttpError(400, 'invalid_email', 'Enter a valid email address.');
  }
  const email = input.trim().toLowerCase();
  if (
    email.length < 3
    || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AccountHttpError(400, 'invalid_email', 'Enter a valid email address.');
  }
  return email;
}

// Lives with the vault now that it labels an address Alice actually holds.
// Re-exported here because every caller and test already reaches for it here.
export { maskEmail } from './email-vault.ts';

export function normalizeUsernamePart(input: unknown, field = 'username'): string {
  if (typeof input !== 'string') {
    throw new AccountHttpError(400, `invalid_${field}`, `Enter a valid ${field}.`);
  }
  const normalized = input
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (
    normalized.length < 2
    || normalized.length > 24
    || RESERVED_USERNAME_PARTS.has(normalized)
  ) {
    throw new AccountHttpError(400, `invalid_${field}`, `Enter a valid ${field}.`);
  }
  return normalized;
}

function normalizeUsername(input: unknown): string {
  if (typeof input !== 'string') {
    throw new AccountHttpError(400, 'invalid_username', 'Enter a valid Alice username.');
  }
  const username = input.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,24}\.[a-z0-9-]{2,24}#[0-9]{4}$/.test(username)) {
    throw new AccountHttpError(400, 'invalid_username', 'Enter a valid Alice username.');
  }
  const [parts] = username.split('#');
  const [prefix, suffix] = parts.split('.');
  if (RESERVED_USERNAME_PARTS.has(prefix) || RESERVED_USERNAME_PARTS.has(suffix)) {
    throw new AccountHttpError(400, 'invalid_username', 'Enter a valid Alice username.');
  }
  return username;
}

function normalizeDisplayName(input: unknown, fallback: string): string {
  if (input === undefined || input === null || input === '') return fallback;
  if (typeof input !== 'string') {
    throw new AccountHttpError(400, 'invalid_display_name', 'Enter a valid display name.');
  }
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 48) {
    throw new AccountHttpError(400, 'invalid_display_name', 'Enter a valid display name.');
  }
  return value;
}

function validatePassword(input: unknown): string {
  if (typeof input !== 'string') {
    throw new AccountHttpError(400, 'invalid_password', 'Enter a valid password.');
  }
  const length = Array.from(input).length;
  const bytes = new TextEncoder().encode(input).byteLength;
  if (
    length < PASSWORD_MIN_LENGTH
    || length > PASSWORD_MAX_LENGTH
    || bytes > 256
  ) {
    throw new AccountHttpError(
      400,
      'invalid_password',
      `Use between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }
  return input;
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt.buffer.slice(
        salt.byteOffset,
        salt.byteOffset + salt.byteLength,
      ) as ArrayBuffer,
      iterations,
    },
    key,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign'],
  );
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.exportKey('raw', derivedKey)),
  );
}

async function deriveScryptHash(
  password: string,
  salt: Uint8Array,
  n = SCRYPT_N,
  r = SCRYPT_R,
  p = SCRYPT_P,
): Promise<string> {
  const hash = await scryptAsync(
    new TextEncoder().encode(password),
    salt,
    {
      N: n,
      r,
      p,
      dkLen: 32,
      maxmem: SCRYPT_MAX_MEMORY,
    },
  );
  return bytesToBase64Url(hash);
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function createAvailableUsername(
  env: Env,
  prefixInput: unknown = 'curious',
  suffixInput?: unknown,
): Promise<{ username: string; prefix: string; suffix: string }> {
  const prefix = normalizeUsernamePart(prefixInput, 'prefix');
  const suffix = suffixInput === undefined
    ? USERNAME_SUFFIXES[randomUint32() % USERNAME_SUFFIXES.length]
    : normalizeUsernamePart(suffixInput, 'suffix');
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const discriminator = String(randomUint32() % 10_000).padStart(4, '0');
    const username = `${prefix}.${suffix}#${discriminator}`;
    const exists = await env.ACCOUNT_DB.prepare(`
      SELECT 1 AS found
      FROM users
      WHERE username = ?
      UNION ALL
      SELECT 1 AS found
      FROM username_history
      WHERE username = ? AND reserved_until > ?
      LIMIT 1
    `).bind(username, username, Date.now()).first<{ found: number }>();
    if (!exists) return { username, prefix, suffix };
  }
  throw new AccountHttpError(
    409,
    'username_unavailable',
    'Alice could not reserve that username. Choose another suffix.',
  );
}

async function selectAvailableUsername(
  env: Env,
  prefixInput: unknown,
  suffixInput: unknown,
  usernameInput?: unknown,
): Promise<{ username: string; prefix: string; suffix: string }> {
  if (usernameInput === undefined) {
    return createAvailableUsername(env, prefixInput, suffixInput);
  }
  const prefix = normalizeUsernamePart(prefixInput, 'prefix');
  const suffix = normalizeUsernamePart(suffixInput, 'suffix');
  const username = normalizeUsername(usernameInput);
  if (!username.startsWith(`${prefix}.${suffix}#`)) {
    throw new AccountHttpError(
      400,
      'invalid_username',
      'The selected username does not match its prefix and suffix.',
    );
  }
  const exists = await env.ACCOUNT_DB.prepare(`
    SELECT 1 AS found
    FROM users
    WHERE username = ?
    UNION ALL
    SELECT 1 AS found
    FROM username_history
    WHERE username = ? AND reserved_until > ?
    LIMIT 1
  `).bind(username, username, Date.now()).first<{ found: number }>();
  if (exists) {
    throw new AccountHttpError(
      409,
      'username_unavailable',
      'That username was just taken. Try creating the account again for new digits.',
    );
  }
  return { username, prefix, suffix };
}

/**
 * Platforms Alice ships. An allowlist rather than a free string: this value
 * is client-supplied, and anything not on this list is dropped rather than
 * stored, so the column can never carry arbitrary text.
 */
const KNOWN_PLATFORMS = new Set([
  'ios',
  'android',
  'web',
  'desktop-macos',
  'desktop-windows',
  'desktop-linux',
]);

export function parsePlatform(request: Request): string | null {
  const value = request.headers.get('x-alice-platform')?.trim().toLowerCase() ?? '';
  return KNOWN_PLATFORMS.has(value) ? value : null;
}

export function parseAppVersion(request: Request): string | null {
  const value = request.headers.get('x-alice-app-version')?.trim() ?? '';
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ? value : null;
}

function parseInstallId(request: Request): string | null {
  const value = request.headers.get('x-alice-install-id')?.trim() ?? '';
  if (!value) return null;
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(value)) {
    throw new AccountHttpError(400, 'invalid_install_id', 'Invalid installation identifier.');
  }
  return value;
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > 8_192) {
    throw new AccountHttpError(413, 'body_too_large', 'Request body is too large.');
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new AccountHttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AccountHttpError(400, 'invalid_json', 'Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export async function rateLimit(
  env: Env,
  bucket: string,
  action: string,
  limit: number,
  now: number,
  windowMs = RATE_LIMIT_WINDOW_MS,
): Promise<void> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const result = await env.ACCOUNT_DB.prepare(`
    INSERT INTO auth_rate_limits (
      bucket, action, window_start, request_count, expires_at
    ) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (bucket, action, window_start)
    DO UPDATE SET request_count = request_count + 1
    RETURNING request_count
  `).bind(bucket, action, windowStart, windowStart + windowMs)
    .first<{ request_count: number }>();
  if (!result || result.request_count > limit) {
    throw new AccountHttpError(429, 'rate_limited', 'Too many attempts. Try again later.');
  }
}

export async function requestIpBucket(request: Request, env: Env, now: number): Promise<string> {
  const rawIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const day = Math.floor(now / (24 * 60 * 60 * 1_000));
  return hmac(env, `ip:${day}:${rawIp}`);
}

async function registerInstallation(
  env: Env,
  userId: string,
  installId: string | null,
  now: number,
  claimFreeGrant = false,
  meta: { platform: string | null; appVersion: string | null } = {
    platform: null,
    appVersion: null,
  },
  identified: boolean | null = null,
): Promise<void> {
  if (!installId) return;
  const installHash = await hmac(env, `install:${installId}`);
  // The milestone marks the first time this installation was tied to a real
  // account, and COALESCE keeps it write-once. The id shape stopped being
  // proof of anything when creation began graduating the anonymous user in
  // place, so a caller that knows better says so through `identified`; the
  // prefix only decides for the callers that predate that.
  const accountCreatedAt = (identified ?? !userId.startsWith('anon_')) ? now : null;
  const statements = [
    env.ACCOUNT_DB.prepare(`
      INSERT INTO installations (
        install_id_hash, first_seen_at, last_seen_at, risk_status,
        platform, app_version, account_created_at
      ) VALUES (?, ?, ?, 'normal', ?, ?, ?)
      ON CONFLICT (install_id_hash)
      DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        platform = COALESCE(excluded.platform, installations.platform),
        app_version = COALESCE(excluded.app_version, installations.app_version),
        account_created_at = COALESCE(
          installations.account_created_at, excluded.account_created_at
        )
    `).bind(
      installHash,
      now,
      now,
      meta.platform,
      meta.appVersion,
      accountCreatedAt,
    ),
    env.ACCOUNT_DB.prepare(`
      INSERT INTO user_installations (
        user_id, install_id_hash, linked_at, last_used_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, install_id_hash)
      DO UPDATE SET last_used_at = excluded.last_used_at
    `).bind(userId, installHash, now, now),
  ];
  if (claimFreeGrant) {
    statements.push(
      env.ACCOUNT_DB.prepare(`
        INSERT OR IGNORE INTO free_grants (
          id, user_id, install_id_hash, request_limit, granted_at
        ) VALUES (?, ?, ?, ?, ?)
      `).bind(uuid(), userId, installHash, FREE_REQUEST_LIMIT, now),
      env.ACCOUNT_DB.prepare(`
        UPDATE entitlements
        SET free_cloud_requests_limit = ?, updated_at = ?
        WHERE user_id = ?
          AND EXISTS (
            SELECT 1 FROM free_grants
            WHERE free_grants.user_id = ?
          )
      `).bind(FREE_REQUEST_LIMIT, now, userId, userId),
    );
  }
  await env.ACCOUNT_DB.batch(statements);
}

export function installMeta(request: Request): {
  platform: string | null;
  appVersion: string | null;
} {
  return { platform: parsePlatform(request), appVersion: parseAppVersion(request) };
}

/**
 * Record write-once cloud-request milestones for an installation.
 *
 * Called after a Private Cloud request is confirmed. Deliberately stores
 * only "the Nth request happened at T" for a couple of fixed N values, not
 * a per-request timeline: enough to measure activation and whether 21 free
 * requests is the right number, without a usage log.
 */
export async function recordCloudRequestMilestones(
  request: Request,
  env: Env,
  used: number,
  limit: number,
  now = Date.now(),
): Promise<void> {
  let installId: string | null;
  try {
    installId = parseInstallId(request);
  } catch {
    return;
  }
  if (!installId) return;
  const installHash = await hmac(env, `install:${installId}`);
  const exhausted = limit > 0 && used >= limit ? now : null;
  const tenth = used >= 10 ? now : null;
  await env.ACCOUNT_DB.prepare(`
    UPDATE installations
    SET
      first_cloud_request_at = COALESCE(first_cloud_request_at, ?),
      tenth_cloud_request_at = COALESCE(tenth_cloud_request_at, ?),
      quota_exhausted_at = COALESCE(quota_exhausted_at, ?)
    WHERE install_id_hash = ?
  `).bind(now, tenth, exhausted, installHash).run();
}

/**
 * Verify a password against an account's stored credential, without
 * creating a session. Used only to re-confirm an admin's identity before a
 * destructive action. Returns false rather than throwing when the account
 * has no password credential at all.
 */
export async function verifyPasswordFor(
  env: Env,
  userId: string,
  password: unknown,
): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) return false;
  const credential = await env.ACCOUNT_DB.prepare(`
    SELECT password_hash, algorithm, iterations, scrypt_n, scrypt_r, scrypt_p, salt
    FROM password_credentials
    WHERE user_id = ?
  `).bind(userId).first<{
    password_hash: string;
    algorithm: string;
    iterations: number | null;
    scrypt_n: number | null;
    scrypt_r: number | null;
    scrypt_p: number | null;
    salt: string;
  }>();
  if (!credential) return false;
  const candidate = credential.algorithm === 'pbkdf2-sha256'
    ? await derivePasswordHash(
        password,
        base64UrlToBytes(credential.salt),
        credential.iterations ?? PASSWORD_ITERATIONS,
      )
    : await deriveScryptHash(
        password,
        base64UrlToBytes(credential.salt),
        credential.scrypt_n ?? SCRYPT_N,
        credential.scrypt_r ?? SCRYPT_R,
        credential.scrypt_p ?? SCRYPT_P,
      );
  return constantTimeEqual(candidate, credential.password_hash);
}

export async function createAnonymousSession(request: Request, env: Env) {
  const now = Date.now();
  const installId = parseInstallId(request);
  if (!installId) {
    throw new AccountHttpError(
      400,
      'missing_install_id',
      'An Alice installation identifier is required.',
    );
  }
  const installHash = await hmac(env, `install:${installId}`);
  const ipBucket = await requestIpBucket(request, env, now);
  await rateLimit(env, ipBucket, 'ip_anonymous_session', 120, now);

  // The anonymous user is derived from the install id, which lives in plain
  // localStorage. That is fine exactly as long as the user stays anonymous:
  // the id opens an account that anyone on the machine could open anyway.
  // The moment an email is linked, that same derivation becomes a skeleton
  // key: sign out, and the next bare /auth/anonymous call on this machine
  // would walk straight back into the account, plan, password and all. So a
  // graduated slot is never reopened; the installation moves to the next
  // one, and the account it left behind opens only with its own credentials.
  let userId = '';
  for (let epoch = 0; ; epoch++) {
    const seed = epoch === 0 ? `anonymous:${installId}` : `anonymous:${installId}:${epoch}`;
    const candidate = `anon_${await hmac(env, seed)}`;
    const graduated = await env.ACCOUNT_DB.prepare(
      'SELECT 1 AS present FROM user_identities WHERE user_id = ? LIMIT 1',
    ).bind(candidate).first<{ present: number }>();
    if (!graduated) {
      userId = candidate;
      break;
    }
    if (epoch >= 12) {
      // Twelve accounts created and abandoned from one installation is not a
      // person losing their password, it is a loop.
      throw new AccountHttpError(429, 'too_many_accounts', 'Too many accounts from this installation.');
    }
  }

  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      INSERT OR IGNORE INTO users (
        id, status, username, display_name, created_at, updated_at
      ) VALUES (?, 'active', NULL, NULL, ?, ?)
    `).bind(userId, now, now),
    env.ACCOUNT_DB.prepare(`
      INSERT OR IGNORE INTO entitlements (
        user_id, plan, cloud_enabled, free_cloud_requests_limit,
        created_at, updated_at
      ) VALUES (?, 'free', 1, 0, ?, ?)
    `).bind(userId, now, now),
    env.ACCOUNT_DB.prepare(`
      INSERT OR IGNORE INTO usage_counters (
        user_id, free_cloud_requests_used, version, updated_at
      ) VALUES (?, 0, 0, ?)
    `).bind(userId, now),
  ]);
  await registerInstallation(env, userId, installId, now, true, installMeta(request));

  const risk = await env.ACCOUNT_DB.prepare(`
    SELECT risk_status FROM installations WHERE install_id_hash = ?
  `).bind(installHash).first<{ risk_status: string }>();
  if (risk?.risk_status === 'blocked') {
    throw new AccountHttpError(403, 'installation_blocked', 'This installation cannot use Private Cloud.');
  }
  return createSession(env, userId, now);
}

async function createSession(
  env: Env,
  userId: string,
  now: number,
  identityId: string | null = null,
) {
  const sessionId = uuid();
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const accessTokenHash = await hmac(env, `access:${accessToken}`);
  const refreshTokenHash = await hmac(env, `refresh:${refreshToken}`);
  const accessExpiresAt = now + ACCESS_TOKEN_TTL_MS;
  const refreshExpiresAt = now + REFRESH_TOKEN_TTL_MS;

  await env.ACCOUNT_DB.prepare(`
    INSERT INTO sessions (
      id, user_id, access_token_hash, access_expires_at,
      refresh_token_hash, refresh_expires_at, created_at, last_used_at
      , identity_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sessionId,
    userId,
    accessTokenHash,
    accessExpiresAt,
    refreshTokenHash,
    refreshExpiresAt,
    now,
    now,
    identityId,
  ).run();

  return {
    access_token: accessToken,
    access_expires_at: accessExpiresAt,
    refresh_token: refreshToken,
    refresh_expires_at: refreshExpiresAt,
  };
}

export function accountEmailConfigured(env: Env): boolean {
  const provider = env.AUTH_EMAIL_PROVIDER?.trim().toLowerCase() || 'cloudflare';
  if (provider === 'resend') return Boolean(env.RESEND_API_KEY);
  return provider === 'cloudflare' && Boolean(env.EMAIL);
}

async function sendLoginCode(env: Env, email: string, code: string): Promise<void> {
  await sendAccountEmail(env, email, {
    subject: `${code} is your Alice login code`,
    text: `Your Alice login code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
    html: `<p>Your Alice login code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you did not request it, you can ignore this email.</p>`,
  });
}

/**
 * Send one transactional email through whichever provider is configured.
 *
 * Alice only ever sends mail a user asked for: a login code they just
 * requested, or a renewal reminder for a plan they bought and an address they
 * volunteered. There is no bulk path here on purpose.
 */
export async function sendAccountEmail(
  env: Env,
  email: string,
  message: { subject: string; text: string; html: string },
): Promise<void> {
  const { subject, text, html } = message;
  const from = env.AUTH_EMAIL_FROM?.trim();
  if (!from) {
    throw new AccountHttpError(500, 'email_not_configured', 'Login email is not configured.');
  }
  const provider = env.AUTH_EMAIL_PROVIDER?.trim().toLowerCase() || 'cloudflare';

  try {
    if (provider === 'resend') {
      if (!env.RESEND_API_KEY) {
        throw new AccountHttpError(
          500,
          'email_not_configured',
          'Login email is not configured.',
        );
      }
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Alice <${from}>`,
          to: [email],
          subject,
          text,
          html,
        }),
      });
      if (!response.ok) {
        throw new AccountHttpError(
          502,
          'email_delivery_failed',
          'Alice could not send this email. Try again later.',
        );
      }
      return;
    }

    if (provider !== 'cloudflare' || !env.EMAIL) {
      throw new AccountHttpError(
        500,
        'email_not_configured',
        'Login email is not configured.',
      );
    }
    await env.EMAIL.send({
      to: email,
      from: { email: from, name: 'Alice' },
      subject,
      text,
      html,
    });
  } catch (error) {
    if (error instanceof AccountHttpError) throw error;
    throw new AccountHttpError(
      502,
      'email_delivery_failed',
      'Alice could not send this email. Try again later.',
    );
  }
}

export async function startEmailLogin(
  request: Request,
  env: Env,
  linkUserId: string | null = null,
): Promise<{ retry_after_seconds: number }> {
  const now = Date.now();
  const body = await parseJsonBody(request);
  const email = normalizeEmail(body.email);
  const emailLookup = await hmac(env, `email:${email}`);
  const ipBucket = await requestIpBucket(request, env, now);

  await rateLimit(env, emailLookup, 'email_start', EMAIL_SEND_LIMIT, now);
  await rateLimit(env, ipBucket, 'ip_email_start', IP_SEND_LIMIT, now);
  const currentChallenge = await env.ACCOUNT_DB.prepare(`
    SELECT consumed_at, updated_at
    FROM email_challenges
    WHERE email_lookup = ?
  `).bind(emailLookup).first<{
    consumed_at: number | null;
    updated_at: number;
  }>();
  if (
    currentChallenge
    && currentChallenge.consumed_at === null
    && currentChallenge.updated_at > now - EMAIL_RESEND_DELAY_MS
  ) {
    throw new AccountHttpError(
      429,
      'email_resend_too_soon',
      'Wait before requesting another login code.',
    );
  }

  const code = randomCode();
  const codeHash = await hmac(env, `code:${emailLookup}:${code}`);
  await env.ACCOUNT_DB.prepare(`
    INSERT INTO email_challenges (
      email_lookup, code_hash, expires_at, attempt_count,
      consumed_at, created_at, updated_at, link_user_id
    ) VALUES (?, ?, ?, 0, NULL, ?, ?, ?)
    ON CONFLICT (email_lookup)
    DO UPDATE SET
      code_hash = excluded.code_hash,
      expires_at = excluded.expires_at,
      attempt_count = 0,
      consumed_at = NULL,
      updated_at = excluded.updated_at,
      link_user_id = excluded.link_user_id
  `).bind(
    emailLookup,
    codeHash,
    now + EMAIL_CODE_TTL_MS,
    now,
    now,
    linkUserId,
  ).run();

  try {
    await sendLoginCode(env, email, code);
  } catch (error) {
    await env.ACCOUNT_DB.prepare(
      'DELETE FROM email_challenges WHERE email_lookup = ? AND code_hash = ?',
    ).bind(emailLookup, codeHash).run();
    throw error;
  }

  return { retry_after_seconds: 60 };
}

export async function verifyEmailLogin(
  request: Request,
  env: Env,
  linkUserId: string | null = null,
) {
  const now = Date.now();
  const body = await parseJsonBody(request);
  const email = normalizeEmail(body.email);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    throw new AccountHttpError(400, 'invalid_code', 'The login code is invalid or expired.');
  }

  const installId = parseInstallId(request);
  const emailLookup = await hmac(env, `email:${email}`);
  const ipBucket = await requestIpBucket(request, env, now);
  await rateLimit(env, emailLookup, 'email_verify', VERIFY_LIMIT, now);
  await rateLimit(env, ipBucket, 'ip_email_verify', VERIFY_LIMIT * 2, now);

  const challenge = await env.ACCOUNT_DB.prepare(`
    SELECT code_hash, expires_at, attempt_count, consumed_at, link_user_id
    FROM email_challenges
    WHERE email_lookup = ?
  `).bind(emailLookup).first<{
    code_hash: string;
    expires_at: number;
    attempt_count: number;
    consumed_at: number | null;
    link_user_id: string | null;
  }>();

  const candidateHash = await hmac(env, `code:${emailLookup}:${code}`);
  const valid = challenge
    && challenge.consumed_at === null
    && challenge.expires_at > now
    && challenge.attempt_count < MAX_CODE_ATTEMPTS
    && challenge.link_user_id === linkUserId
    && constantTimeEqual(challenge.code_hash, candidateHash);

  if (!valid) {
    if (challenge && challenge.consumed_at === null) {
      await env.ACCOUNT_DB.prepare(`
        UPDATE email_challenges
        SET attempt_count = attempt_count + 1, updated_at = ?
        WHERE email_lookup = ?
      `).bind(now, emailLookup).run();
    }
    throw new AccountHttpError(400, 'invalid_code', 'The login code is invalid or expired.');
  }

  let identity: {
    id: string;
    user_id: string;
    status?: string;
  } | null = await env.ACCOUNT_DB.prepare(`
    SELECT user_identities.id, user_identities.user_id, users.status
    FROM user_identities
    JOIN users ON users.id = user_identities.user_id
    WHERE user_identities.provider = 'email'
      AND user_identities.provider_subject = ?
  `).bind(emailLookup).first<{ id: string; user_id: string; status: string }>();
  if (identity && identity.status !== 'active') {
    throw new AccountHttpError(403, 'account_unavailable', 'This Alice account is unavailable.');
  }
  const linkIdentityAlreadyPresent = Boolean(
    linkUserId && identity?.user_id === linkUserId,
  );
  // Read before the synthesis below rewrites `identity` for the link flow:
  // afterwards nothing can tell a fresh link from a repeated one.
  const emailWasUnknown = !identity;
  if (!identity) {
    if (linkUserId) {
      identity = { id: uuid(), user_id: linkUserId };
    }
  } else if (linkUserId && identity.user_id !== linkUserId) {
    throw new AccountHttpError(
      409,
      'identity_already_linked',
      'This email is already linked to another Alice account.',
    );
  }
  // Null here means null and no link user, since the branch above assigns one
  // whenever there is a link user. Written this way rather than with the extra
  // condition so the invariant is the compiler's too, not just the reader's.
  if (!identity) {
    // Signing in used to create the account it could not find, which meant
    // any address that received a code became an Alice account whether its
    // owner wanted one or not. Creation is a decision, and it has its own
    // flow: an anonymous session that links this email deliberately. Sign-in
    // only opens doors that already exist. Saying so leaks nothing: the only
    // person who can reach this line is holding a valid code, and therefore
    // the inbox itself.
    throw new AccountHttpError(
      404,
      'account_not_found',
      'No Alice account uses this email address.',
    );
  }
  if (emailWasUnknown && linkUserId) {
    // This is the moment an account is actually created: an anonymous user
    // takes its first identity. The per-IP creation limit lives here now that
    // sign-in no longer creates anything, and it runs before the code is
    // consumed so a refused attempt does not burn it.
    await rateLimit(
      env,
      ipBucket,
      'ip_account_create',
      IP_ACCOUNT_CREATION_LIMIT,
      now,
      ACCOUNT_CREATION_WINDOW_MS,
    );
  }

  // A password, once set, is asked for at every sign-in. The code alone stops
  // being a key and becomes the reset path: proving the inbox lets you choose
  // a new password, in the same breath, never skip it. Checked before the
  // code is consumed so the refusal costs nothing and the same code still
  // serves the retry that carries a new password.
  const newPassword = body.new_password === undefined || body.new_password === null
    ? null
    : validatePassword(body.new_password);
  if (!linkUserId && identity && newPassword === null) {
    const guarded = await env.ACCOUNT_DB.prepare(`
      SELECT user_id FROM password_credentials WHERE user_id = ?
    `).bind(identity.user_id).first<{ user_id: string }>();
    if (guarded) {
      throw new AccountHttpError(
        403,
        'password_required',
        'This account has a password. Sign in with it, or reset it here with a new one.',
      );
    }
  }

  const consumed = await env.ACCOUNT_DB.prepare(`
    UPDATE email_challenges
    SET consumed_at = ?, updated_at = ?
    WHERE email_lookup = ? AND consumed_at IS NULL AND expires_at > ?
  `).bind(now, now, emailLookup, now).run();
  if ((consumed.meta.changes ?? 0) !== 1) {
    throw new AccountHttpError(400, 'invalid_code', 'The login code is invalid or expired.');
  }

  if (linkUserId && !linkIdentityAlreadyPresent) {
    const inserted = await env.ACCOUNT_DB.prepare(`
      INSERT INTO user_identities (
        id, user_id, provider, provider_subject, display_label,
        verified_at, created_at, last_used_at
      ) VALUES (?, ?, 'email', ?, ?, ?, ?, ?)
      ON CONFLICT (provider, provider_subject) DO NOTHING
    `).bind(
      identity.id,
      linkUserId,
      emailLookup,
      maskEmail(email),
      now,
      now,
      now,
    ).run();
    if ((inserted.meta.changes ?? 0) !== 1) {
      throw new AccountHttpError(
        409,
        'identity_already_linked',
        'This email is already linked to another Alice account.',
      );
    }
  } else {
    await env.ACCOUNT_DB.prepare(`
      UPDATE user_identities SET last_used_at = ?
      WHERE provider = 'email' AND provider_subject = ?
    `).bind(now, emailLookup).run();
  }

  if (linkUserId) {
    // The address was just proved by a code, so it is verified by definition.
    await rememberAccountEmail(env, linkUserId, email, { verified: true, now });
    if (emailWasUnknown) {
      // The graduation is this installation's account-creation milestone,
      // and nothing else will ever stamp it: the user keeps its anonymous id
      // for life, so the shape-based default would file it under nobody.
      await registerInstallation(
        env, linkUserId, installId, now, false, installMeta(request), true,
      );
    }
    return { account: await getAccountSnapshot(env, linkUserId) };
  }
  if (!identity) {
    throw new AccountHttpError(500, 'account_creation_failed', 'Alice could not create this account.');
  }
  if (newPassword !== null) {
    // The reset promised above: the inbox was proved, the new password rides
    // the same request, and the old one stops working in the same instant.
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const passwordHash = await derivePasswordHash(newPassword, salt);
    await env.ACCOUNT_DB.prepare(`
      INSERT INTO password_credentials (
        user_id, password_hash, algorithm, iterations,
        scrypt_n, scrypt_r, scrypt_p, salt,
        created_at, updated_at, last_used_at
      ) VALUES (?, ?, 'pbkdf2-sha256', ?, NULL, NULL, NULL, ?, ?, ?, NULL)
      ON CONFLICT (user_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        algorithm = excluded.algorithm,
        iterations = excluded.iterations,
        scrypt_n = excluded.scrypt_n,
        scrypt_r = excluded.scrypt_r,
        scrypt_p = excluded.scrypt_p,
        salt = excluded.salt,
        updated_at = excluded.updated_at
    `).bind(
      identity.user_id,
      passwordHash,
      PASSWORD_ITERATIONS,
      bytesToBase64Url(salt),
      now,
      now,
    ).run();
  }
  // Written on every code login, not only at creation. Accounts made before
  // Alice kept an address repair themselves the next time their owner signs
  // in, with nothing to ask: they type the address to log in anyway.
  await rememberAccountEmail(env, identity.user_id, email, { verified: true, now });
  await registerInstallation(env, identity.user_id, installId, now, true, installMeta(request));
  const tokens = await createSession(env, identity.user_id, now, identity.id);
  const account = await getAccountSnapshot(env, identity.user_id);
  return { ...tokens, account };
}

/**
 * The one thing an account holder chooses about mail.
 *
 * There is no endpoint to set the address itself, deliberately. The address is
 * whichever one signs the account in, proved by a code, which is what keeps
 * "where Alice writes" and "who owns this account" from drifting apart. Adding
 * or changing it goes through the same verification as any other identity.
 */
export async function updateEmailPreferences(request: Request, env: Env) {
  const user = await authenticate(request, env);
  const body = await parseJsonBody(request);
  if (typeof body.product_updates !== 'boolean') {
    throw new AccountHttpError(400, 'invalid_preference', 'Choose whether to receive product updates.');
  }
  await setProductUpdates(env, user.userId, body.product_updates);
  return getAccountSnapshot(env, user.userId);
}

export async function startEmailIdentityLink(request: Request, env: Env) {
  const user = await authenticate(request, env);
  return startEmailLogin(request, env, user.userId);
}

export async function verifyEmailIdentityLink(request: Request, env: Env) {
  const user = await authenticate(request, env);
  return verifyEmailLogin(request, env, user.userId);
}

/**
 * The parts a username is built from, before any name has been typed.
 *
 * The picker needs the middle words and the number the moment it opens, not
 * once someone has finished typing: a number that appears only after the name
 * looks like a consequence of the name, and it is not one. The number is drawn
 * here and belongs to that screen from then on.
 *
 * Availability is not checked, because there is nothing to check yet: a
 * username only exists once a name is attached to it. The collision is one
 * chance in ten thousand per name, and the create call catches it and says so
 * rather than pretending it cannot happen.
 */
export async function usernameVocabulary(request: Request, env: Env) {
  const now = Date.now();
  await rateLimit(
    env,
    await requestIpBucket(request, env, now),
    'ip_username_suggestions',
    60,
    now,
  );
  return {
    suffixes: [...USERNAME_SUFFIXES],
    discriminator: String(randomUint32() % 10_000).padStart(4, '0'),
  };
}

export async function suggestUsernames(request: Request, env: Env) {
  const now = Date.now();
  const body = await parseJsonBody(request);
  const prefix = normalizeUsernamePart(body.prefix, 'prefix');
  await rateLimit(
    env,
    await requestIpBucket(request, env, now),
    'ip_username_suggestions',
    60,
    now,
  );
  // Two shapes for two screens. The default is five shuffled picks. With
  // `all`, every suffix comes back once, in its declared order, and they all
  // share ONE set of digits: the picker reads left to right as name, then a
  // middle word to scroll through, then a number that is already decided and
  // does not flinch while the person browses. Digits that changed with every
  // choice would make the number look like part of the choice, and it is not.
  const wantAll = body.all === true;
  const suffixes = [...USERNAME_SUFFIXES];
  if (wantAll) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const discriminator = String(randomUint32() % 10_000).padStart(4, '0');
      const usernames = suffixes.map(suffix => `${prefix}.${suffix}#${discriminator}`);
      const placeholders = usernames.map(() => '?').join(', ');
      const taken = await env.ACCOUNT_DB.prepare(`
        SELECT 1 AS found FROM users WHERE username IN (${placeholders})
        UNION ALL
        SELECT 1 AS found FROM username_history
        WHERE username IN (${placeholders}) AND reserved_until > ?
        LIMIT 1
      `).bind(...usernames, ...usernames, now).first<{ found: number }>();
      if (!taken) {
        return {
          display_name: normalizeDisplayName(body.display_name, String(body.prefix).trim()),
          suggestions: suffixes.map(suffix => ({
            username: `${prefix}.${suffix}#${discriminator}`,
            prefix,
            suffix,
          })),
        };
      }
    }
    // 32 misses across 10,000 discriminators means the namespace around this
    // prefix is genuinely crowded; fall through to per-suffix digits rather
    // than failing the screen.
  }
  if (!wantAll) {
    for (let index = suffixes.length - 1; index > 0; index -= 1) {
      const swap = randomUint32() % (index + 1);
      [suffixes[index], suffixes[swap]] = [suffixes[swap], suffixes[index]];
    }
  }
  const suggestions = [];
  for (const suffix of (wantAll ? suffixes : suffixes.slice(0, 5))) {
    suggestions.push(await createAvailableUsername(env, prefix, suffix));
  }
  return {
    display_name: normalizeDisplayName(body.display_name, String(body.prefix).trim()),
    suggestions,
  };
}

export async function loginWithPassword(request: Request, env: Env) {
  const now = Date.now();
  const body = await parseJsonBody(request);
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  const password = validatePassword(body.password);
  const identifierBucket = await hmac(env, `password-login:${identifier.toLowerCase()}`);
  const ipBucket = await requestIpBucket(request, env, now);
  await rateLimit(env, identifierBucket, 'password_login', PASSWORD_LOGIN_LIMIT, now);
  await rateLimit(env, ipBucket, 'ip_password_login', VERIFY_LIMIT * 2, now);

  let userId: string | null = null;
  if (identifier.includes('@')) {
    const email = normalizeEmail(identifier);
    const emailLookup = await hmac(env, `email:${email}`);
    userId = (await env.ACCOUNT_DB.prepare(`
      SELECT users.id
      FROM users
      JOIN user_identities ON user_identities.user_id = users.id
      WHERE user_identities.provider = 'email'
        AND user_identities.provider_subject = ?
        AND users.status = 'active'
    `).bind(emailLookup).first<{ id: string }>())?.id ?? null;
  } else {
    const username = normalizeUsername(identifier);
    userId = (await env.ACCOUNT_DB.prepare(`
      SELECT id FROM users WHERE username = ? AND status = 'active'
    `).bind(username).first<{ id: string }>())?.id ?? null;
  }

  const credential = userId
    ? await env.ACCOUNT_DB.prepare(`
        SELECT
          password_hash, algorithm, iterations,
          scrypt_n, scrypt_r, scrypt_p, salt
        FROM password_credentials
        WHERE user_id = ?
      `).bind(userId).first<{
        password_hash: string;
        algorithm: string;
        iterations: number | null;
        scrypt_n: number | null;
        scrypt_r: number | null;
        scrypt_p: number | null;
        salt: string;
      }>()
    : null;
  const dummySalt = new Uint8Array(16);
  const candidateHash = credential?.algorithm === 'pbkdf2-sha256'
    ? await derivePasswordHash(
        password,
        base64UrlToBytes(credential.salt),
        credential.iterations ?? PASSWORD_ITERATIONS,
      )
    : await deriveScryptHash(
        password,
        credential ? base64UrlToBytes(credential.salt) : dummySalt,
        credential?.scrypt_n ?? SCRYPT_N,
        credential?.scrypt_r ?? SCRYPT_R,
        credential?.scrypt_p ?? SCRYPT_P,
      );
  if (
    !userId
    || !credential
    || !['pbkdf2-sha256', 'scrypt'].includes(credential.algorithm)
    || !constantTimeEqual(candidateHash, credential.password_hash)
  ) {
    throw new AccountHttpError(
      401,
      'invalid_credentials',
      'The username, email or password is incorrect.',
    );
  }

  if (credential.algorithm === 'scrypt') {
    // A surviving scrypt row is a live grenade: verifying it is the very
    // computation that blows the CPU budget, so each login it survives is
    // the last one it should ever serve. Re-derive with the cheap hash while
    // the correct password is in hand; the next login never runs scrypt.
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const rehash = await derivePasswordHash(password, salt);
    await env.ACCOUNT_DB.prepare(`
      UPDATE password_credentials
      SET password_hash = ?, algorithm = 'pbkdf2-sha256', iterations = ?,
          scrypt_n = NULL, scrypt_r = NULL, scrypt_p = NULL, salt = ?,
          updated_at = ?, last_used_at = ?
      WHERE user_id = ?
    `).bind(rehash, PASSWORD_ITERATIONS, bytesToBase64Url(salt), now, now, userId).run();
  } else {
    await env.ACCOUNT_DB.prepare(`
      UPDATE password_credentials SET last_used_at = ? WHERE user_id = ?
    `).bind(now, userId).run();
  }
  await registerInstallation(env, userId, parseInstallId(request), now, true, installMeta(request));
  const tokens = await createSession(env, userId, now);
  return { ...tokens, account: await getAccountSnapshot(env, userId) };
}

export async function setAccountPassword(request: Request, env: Env) {
  const user = await authenticate(request, env);
  const now = Date.now();
  const body = await parseJsonBody(request);
  const password = validatePassword(body.password);
  const current = await env.ACCOUNT_DB.prepare(`
    SELECT username, display_name FROM users WHERE id = ?
  `).bind(user.userId).first<{ username: string | null; display_name: string | null }>();
  if (!current) {
    throw new AccountHttpError(404, 'account_not_found', 'Alice account not found.');
  }

  let username = current.username;
  let displayName = current.display_name;
  if (!username) {
    const profile = await selectAvailableUsername(
      env,
      body.prefix,
      body.suffix,
      body.username,
    );
    username = profile.username;
    displayName = normalizeDisplayName(body.display_name, String(body.prefix).trim());
  }
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  // Native WebCrypto, not scrypt-in-JavaScript: see PASSWORD_ITERATIONS.
  const passwordHash = await derivePasswordHash(password, salt);
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      UPDATE users
      SET username = ?, display_name = COALESCE(?, display_name), updated_at = ?
      WHERE id = ?
    `).bind(username, displayName, now, user.userId),
    env.ACCOUNT_DB.prepare(`
      INSERT INTO password_credentials (
        user_id, password_hash, algorithm, iterations,
        scrypt_n, scrypt_r, scrypt_p, salt,
        created_at, updated_at, last_used_at
      ) VALUES (?, ?, 'pbkdf2-sha256', ?, NULL, NULL, NULL, ?, ?, ?, NULL)
      ON CONFLICT (user_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        algorithm = excluded.algorithm,
        iterations = excluded.iterations,
        scrypt_n = excluded.scrypt_n,
        scrypt_r = excluded.scrypt_r,
        scrypt_p = excluded.scrypt_p,
        salt = excluded.salt,
        updated_at = excluded.updated_at
    `).bind(
      user.userId,
      passwordHash,
      PASSWORD_ITERATIONS,
      bytesToBase64Url(salt),
      now,
      now,
    ),
  ]);
  return { account: await getAccountSnapshot(env, user.userId) };
}

export async function updateAccountProfile(request: Request, env: Env) {
  const user = await authenticate(request, env);
  const now = Date.now();
  const body = await parseJsonBody(request);
  const current = await env.ACCOUNT_DB.prepare(`
    SELECT username, display_name, username_updated_at
    FROM users
    WHERE id = ?
  `).bind(user.userId).first<{
    username: string | null;
    display_name: string | null;
    username_updated_at: number | null;
  }>();
  if (!current) {
    throw new AccountHttpError(404, 'account_not_found', 'Alice account not found.');
  }

  const displayName = body.display_name === undefined
    ? current.display_name
    : normalizeDisplayName(body.display_name, current.display_name ?? 'Curious');
  const wantsUsernameChange = body.prefix !== undefined || body.suffix !== undefined;
  if (!wantsUsernameChange) {
    await env.ACCOUNT_DB.prepare(`
      UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?
    `).bind(displayName, now, user.userId).run();
    return { account: await getAccountSnapshot(env, user.userId) };
  }
  if (body.prefix === undefined || body.suffix === undefined) {
    throw new AccountHttpError(
      400,
      'invalid_username',
      'Choose both a username prefix and suffix.',
    );
  }
  if (
    current.username_updated_at
    && current.username_updated_at > now - USERNAME_CHANGE_WINDOW_MS
  ) {
    throw new AccountHttpError(
      429,
      'username_change_too_soon',
      'A username can be changed once every 30 days.',
    );
  }

  const profile = await selectAvailableUsername(
    env,
    body.prefix,
    body.suffix,
    body.username,
  );
  const statements = [];
  if (current.username) {
    statements.push(env.ACCOUNT_DB.prepare(`
      INSERT INTO username_history (
        username, user_id, released_at, reserved_until, created_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (username) DO UPDATE SET
        user_id = excluded.user_id,
        released_at = excluded.released_at,
        reserved_until = excluded.reserved_until
    `).bind(
      current.username,
      user.userId,
      now,
      now + USERNAME_RESERVATION_MS,
      now,
    ));
  }
  statements.push(env.ACCOUNT_DB.prepare(`
    UPDATE users
    SET username = ?, display_name = ?, username_updated_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(profile.username, displayName, now, now, user.userId));
  await env.ACCOUNT_DB.batch(statements);
  return { account: await getAccountSnapshot(env, user.userId) };
}

type AuthChallengeRow = {
  id: string;
  purpose: string;
  user_id: string | null;
  provider_subject: string | null;
  challenge: string;
  payload: string | null;
  expires_at: number;
  attempt_count: number;
  consumed_at: number | null;
};

async function createAuthChallenge(
  env: Env,
  purpose: AuthChallengeRow['purpose'],
  userId: string | null,
  providerSubject: string | null,
  payload: Record<string, unknown> | null = null,
) {
  const now = Date.now();
  const id = uuid();
  const challenge = randomToken();
  const expiresAt = now + CRYPTO_CHALLENGE_TTL_MS;
  await env.ACCOUNT_DB.prepare(`
    INSERT INTO auth_challenges (
      id, purpose, user_id, provider_subject, challenge,
      payload, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    purpose,
    userId,
    providerSubject,
    challenge,
    payload ? JSON.stringify(payload) : null,
    expiresAt,
    now,
  ).run();
  return { id, challenge, expiresAt };
}

async function rateLimitCryptoStart(
  request: Request,
  env: Env,
  provider: string,
  subject: string | null = null,
): Promise<void> {
  const now = Date.now();
  await rateLimit(
    env,
    await requestIpBucket(request, env, now),
    `ip_${provider}_start`,
    IP_SEND_LIMIT,
    now,
  );
  if (subject) {
    await rateLimit(
      env,
      await hmac(env, `${provider}:${subject}`),
      `${provider}_start`,
      EMAIL_SEND_LIMIT,
      now,
    );
  }
}

async function rateLimitCryptographicAccountCreation(
  request: Request,
  env: Env,
): Promise<void> {
  const now = Date.now();
  await rateLimit(
    env,
    await requestIpBucket(request, env, now),
    'ip_account_create',
    IP_ACCOUNT_CREATION_LIMIT,
    now,
    ACCOUNT_CREATION_WINDOW_MS,
  );
}

async function readAuthChallenge(
  env: Env,
  challengeId: unknown,
  expectedPurpose: string,
): Promise<AuthChallengeRow> {
  if (typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/.test(challengeId)) {
    throw new AccountHttpError(400, 'invalid_challenge', 'The login challenge is invalid or expired.');
  }
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT
      id, purpose, user_id, provider_subject, challenge,
      payload, expires_at, attempt_count, consumed_at
    FROM auth_challenges
    WHERE id = ?
  `).bind(challengeId).first<AuthChallengeRow>();
  if (
    !row
    || row.purpose !== expectedPurpose
    || row.consumed_at !== null
    || row.expires_at <= Date.now()
    || row.attempt_count >= MAX_CODE_ATTEMPTS
  ) {
    throw new AccountHttpError(400, 'invalid_challenge', 'The login challenge is invalid or expired.');
  }
  return row;
}

async function failAuthChallenge(env: Env, id: string): Promise<never> {
  await env.ACCOUNT_DB.prepare(`
    UPDATE auth_challenges
    SET attempt_count = attempt_count + 1
    WHERE id = ? AND consumed_at IS NULL
  `).bind(id).run();
  throw new AccountHttpError(400, 'invalid_signature', 'The signature could not be verified.');
}

async function consumeAuthChallenge(env: Env, row: AuthChallengeRow): Promise<void> {
  const consumed = await env.ACCOUNT_DB.prepare(`
    UPDATE auth_challenges
    SET consumed_at = ?
    WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
  `).bind(Date.now(), row.id, Date.now()).run();
  if ((consumed.meta.changes ?? 0) !== 1) {
    throw new AccountHttpError(400, 'invalid_challenge', 'The login challenge is invalid or expired.');
  }
}

async function createUserWithIdentity(
  env: Env,
  provider: AccountIdentity['provider'],
  providerSubject: string,
  displayLabel: string,
  now: number,
  profile?: { username: string; displayName: string },
): Promise<{ userId: string; identityId: string }> {
  const userId = uuid();
  const identityId = uuid();
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      INSERT INTO users (
        id, status, username, display_name, created_at, updated_at
      ) VALUES (?, 'active', ?, ?, ?, ?)
    `).bind(
      userId,
      profile?.username ?? null,
      profile?.displayName ?? null,
      now,
      now,
    ),
    env.ACCOUNT_DB.prepare(`
      INSERT INTO user_identities (
        id, user_id, provider, provider_subject, display_label,
        verified_at, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      identityId,
      userId,
      provider,
      providerSubject,
      displayLabel,
      now,
      now,
      now,
    ),
    env.ACCOUNT_DB.prepare(`
      INSERT INTO entitlements (
        user_id, plan, cloud_enabled, free_cloud_requests_limit,
        created_at, updated_at
      ) VALUES (?, 'free', 1, 0, ?, ?)
    `).bind(userId, now, now),
    env.ACCOUNT_DB.prepare(`
      INSERT INTO usage_counters (
        user_id, free_cloud_requests_used, version, updated_at
      ) VALUES (?, 0, 0, ?)
    `).bind(userId, now),
  ]);
  return { userId, identityId };
}

async function completeIdentityLogin(
  request: Request,
  env: Env,
  identity: { id: string; user_id: string },
) {
  const now = Date.now();
  await env.ACCOUNT_DB.prepare(`
    UPDATE user_identities SET last_used_at = ?
    WHERE id = ? AND user_id = ?
  `).bind(now, identity.id, identity.user_id).run();
  await registerInstallation(env, identity.user_id, parseInstallId(request), now, true, installMeta(request));
  const tokens = await createSession(env, identity.user_id, now, identity.id);
  return {
    ...tokens,
    account: await getAccountSnapshot(env, identity.user_id),
  };
}

export async function revokeIdentity(request: Request, env: Env) {
  const user = await authenticate(request, env);
  const body = await parseJsonBody(request);
  const identityId = typeof body.identity_id === 'string' ? body.identity_id : '';
  const identity = await env.ACCOUNT_DB.prepare(`
    SELECT id FROM user_identities
    WHERE id = ? AND user_id = ?
  `).bind(identityId, user.userId).first<{ id: string }>();
  if (!identity) {
    throw new AccountHttpError(404, 'identity_not_found', 'Alice login method not found.');
  }
  const count = await env.ACCOUNT_DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM user_identities WHERE user_id = ?)
      + (SELECT COUNT(*) FROM password_credentials WHERE user_id = ?)
      AS count
  `).bind(user.userId, user.userId).first<{ count: number }>();
  if (!count || count.count <= 1) {
    throw new AccountHttpError(
      409,
      'last_identity',
      'Add another login method before removing this one.',
    );
  }
  const now = Date.now();
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      DELETE FROM user_identities
      WHERE id = ? AND user_id = ?
    `).bind(identityId, user.userId),
    env.ACCOUNT_DB.prepare(`
      UPDATE sessions SET revoked_at = ?
      WHERE user_id = ?
        AND id != ?
        AND revoked_at IS NULL
    `).bind(now, user.userId, user.sessionId),
  ]);
  return getAccountSnapshot(env, user.userId);
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,256})$/i.exec(authorization);
  if (!match) {
    throw new AccountHttpError(401, 'account_required', 'Sign in to use Private Cloud.');
  }
  return match[1];
}

export async function authenticate(request: Request, env: Env): Promise<AuthenticatedUser> {
  const now = Date.now();
  const tokenHash = await hmac(env, `access:${bearerToken(request)}`);
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT
      sessions.id AS session_id,
      sessions.user_id AS user_id,
      sessions.access_expires_at AS access_expires_at,
      users.status AS status
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.access_token_hash = ?
      AND sessions.revoked_at IS NULL
  `).bind(tokenHash).first<SessionUserRow>();
  if (!row || row.access_expires_at <= now || row.status !== 'active') {
    throw new AccountHttpError(401, 'session_expired', 'Your Alice session has expired.');
  }
  return { sessionId: row.session_id, userId: row.user_id };
}

export async function refreshSession(request: Request, env: Env) {
  const now = Date.now();
  const body = await parseJsonBody(request);
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(refreshToken)) {
    throw new AccountHttpError(401, 'invalid_refresh_token', 'Your Alice session has expired.');
  }
  const tokenHash = await hmac(env, `refresh:${refreshToken}`);
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT sessions.id, sessions.user_id, sessions.refresh_expires_at, users.status
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.refresh_token_hash = ?
      AND sessions.revoked_at IS NULL
  `).bind(tokenHash).first<{
    id: string;
    user_id: string;
    refresh_expires_at: number;
    status: string;
  }>();
  if (!row || row.refresh_expires_at <= now || row.status !== 'active') {
    throw new AccountHttpError(401, 'invalid_refresh_token', 'Your Alice session has expired.');
  }

  const accessToken = randomToken();
  const nextRefreshToken = randomToken();
  const accessTokenHash = await hmac(env, `access:${accessToken}`);
  const refreshTokenHash = await hmac(env, `refresh:${nextRefreshToken}`);
  const accessExpiresAt = now + ACCESS_TOKEN_TTL_MS;
  const refreshExpiresAt = now + REFRESH_TOKEN_TTL_MS;

  const rotated = await env.ACCOUNT_DB.prepare(`
    UPDATE sessions
    SET access_token_hash = ?, access_expires_at = ?,
        refresh_token_hash = ?, refresh_expires_at = ?, last_used_at = ?
    WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL
  `).bind(
    accessTokenHash,
    accessExpiresAt,
    refreshTokenHash,
    refreshExpiresAt,
    now,
    row.id,
    tokenHash,
  ).run();
  if ((rotated.meta.changes ?? 0) !== 1) {
    throw new AccountHttpError(401, 'invalid_refresh_token', 'Your Alice session has expired.');
  }

  return {
    access_token: accessToken,
    access_expires_at: accessExpiresAt,
    refresh_token: nextRefreshToken,
    refresh_expires_at: refreshExpiresAt,
  };
}

export async function logout(request: Request, env: Env): Promise<void> {
  const user = await authenticate(request, env);
  await env.ACCOUNT_DB.prepare(`
    UPDATE sessions SET revoked_at = ?
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
  `).bind(Date.now(), user.sessionId, user.userId).run();
}

export async function getAccountSnapshot(env: Env, userId: string): Promise<AccountSnapshot> {
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT
      users.id AS user_id,
      users.status AS status,
      users.username AS username,
      users.display_name AS display_name,
      (
        SELECT display_label
        FROM user_identities
        WHERE user_identities.user_id = users.id
          AND user_identities.provider = 'email'
        ORDER BY created_at ASC
        LIMIT 1
      ) AS email_masked,
      entitlements.plan AS plan,
      entitlements.cloud_enabled AS cloud_enabled,
      entitlements.free_cloud_requests_limit AS free_cloud_requests_limit,
      usage_counters.free_cloud_requests_used AS free_cloud_requests_used
    FROM users
    JOIN entitlements ON entitlements.user_id = users.id
    JOIN usage_counters ON usage_counters.user_id = users.id
    WHERE users.id = ?
  `).bind(userId).first<AccountRow>();
  if (!row) {
    throw new AccountHttpError(404, 'account_not_found', 'Alice account not found.');
  }
  const identityRows = await env.ACCOUNT_DB.prepare(`
    SELECT
      user_identities.id,
      user_identities.provider,
      user_identities.display_label,
      user_identities.created_at,
      user_identities.last_used_at
    FROM user_identities
    WHERE user_identities.user_id = ?
    ORDER BY user_identities.created_at ASC
  `).bind(userId).all<{
    id: string;
    provider: AccountIdentity['provider'];
    display_label: string;
    created_at: number;
    last_used_at: number;
  }>();
  const identities = identityRows.results.slice() as AccountIdentity[];
  const passwordCredential = await env.ACCOUNT_DB.prepare(`
    SELECT created_at, COALESCE(last_used_at, updated_at) AS last_used_at
    FROM password_credentials
    WHERE user_id = ?
  `).bind(userId).first<{ created_at: number; last_used_at: number }>();
  if (passwordCredential) {
    identities.push({
      id: 'password',
      provider: 'password',
      display_label: 'Password',
      created_at: passwordCredential.created_at,
      last_used_at: passwordCredential.last_used_at,
    });
  }
  const contact = await accountEmailMasked(env, userId);
  return {
    user_id: row.user_id,
    is_anonymous: identities.length === 0,
    status: row.status,
    username: row.username,
    display_name: row.display_name,
    email_masked: contact?.masked ?? row.email_masked,
    plan: row.plan,
    cloud_enabled: row.cloud_enabled === 1,
    cloud_requests_limit: row.free_cloud_requests_limit,
    cloud_requests_used: row.free_cloud_requests_used,
    cloud_requests_remaining: Math.max(
      0,
      row.free_cloud_requests_limit - row.free_cloud_requests_used,
    ),
    has_password: Boolean(passwordCredential),
    email_reachable: contact !== null,
    product_updates: contact?.product_updates ?? false,
    identities,
  };
}

export async function getCurrentAccount(request: Request, env: Env): Promise<AccountSnapshot> {
  const user = await authenticate(request, env);
  return getAccountSnapshot(env, user.userId);
}

export async function requestAccountDeletion(request: Request, env: Env): Promise<void> {
  const now = Date.now();
  const user = await authenticate(request, env);
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      UPDATE users
      SET status = 'deletion_requested', updated_at = ?
      WHERE id = ? AND status = 'active'
    `).bind(now, user.userId),
    env.ACCOUNT_DB.prepare(`
      UPDATE sessions SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `).bind(now, user.userId),
  ]);
}

export function requestId(request: Request): string {
  const value = request.headers.get('x-alice-request-id')?.trim() ?? '';
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(value)) {
    throw new AccountHttpError(
      400,
      'missing_request_id',
      'A valid Alice request identifier is required.',
    );
  }
  return value;
}

export async function reserveFreeRequest(
  env: Env,
  userId: string,
  idempotencyKey: string,
): Promise<QuotaReservation> {
  const now = Date.now();
  const ledgerId = uuid();
  const results = await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      INSERT OR IGNORE INTO cloud_request_ledger (
        id, user_id, idempotency_key, request_type,
        status, units, created_at
      )
      SELECT ?, ?, ?, 'standard', 'reserved', 0, ?
      WHERE EXISTS (
        SELECT 1
        FROM entitlements
        JOIN usage_counters ON usage_counters.user_id = entitlements.user_id
        WHERE entitlements.user_id = ?
          AND entitlements.cloud_enabled = 1
          AND usage_counters.free_cloud_requests_used
            < entitlements.free_cloud_requests_limit
      )
    `).bind(ledgerId, userId, idempotencyKey, now, userId),
    env.ACCOUNT_DB.prepare(`
      UPDATE usage_counters
      SET
        free_cloud_requests_used = free_cloud_requests_used + 1,
        version = version + 1,
        updated_at = ?
      WHERE user_id = ?
        AND free_cloud_requests_used < (
          SELECT free_cloud_requests_limit
          FROM entitlements
          WHERE user_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM cloud_request_ledger
          WHERE user_id = ?
            AND idempotency_key = ?
            AND status = 'reserved'
            AND units = 0
        )
    `).bind(now, userId, userId, userId, idempotencyKey),
    env.ACCOUNT_DB.prepare(`
      UPDATE cloud_request_ledger
      SET units = 1
      WHERE user_id = ?
        AND idempotency_key = ?
        AND status = 'reserved'
        AND units = 0
        AND EXISTS (
          SELECT 1 FROM usage_counters
          WHERE user_id = ?
            AND updated_at = ?
        )
    `).bind(userId, idempotencyKey, userId, now),
  ]);

  const ledger = await env.ACCOUNT_DB.prepare(`
    SELECT id, status, units
    FROM cloud_request_ledger
    WHERE user_id = ? AND idempotency_key = ?
  `).bind(userId, idempotencyKey).first<{
    id: string;
    status: string;
    units: number;
  }>();

  if (!ledger || ledger.units !== 1 || ledger.status === 'refunded') {
    throw new AccountHttpError(
      402,
      'free_quota_exhausted',
      'Your 21 free Private Cloud requests have been used.',
    );
  }

  // Whether this call is the one that opened the row, or a second call
  // carrying a request id that already exists.
  const fresh = (results[0].meta.changes ?? 0) === 1;

  // A replayed id whose answer was already delivered is not a retry.
  //
  // The idempotency here was built for the honest case: a stream that dies
  // mid-answer, retried with the same id, must not be charged twice. It did
  // that correctly. What it did not do was tell that case apart from a client
  // sending one id forever, and the caller never looked at the duplicate flag
  // it was handed. The counters stayed still while every replay went upstream,
  // so twenty-one free requests bought an unlimited number of them, and a paid
  // allowance bought an unlimited number of those. Alice paid Venice for all
  // of it.
  //
  // 'confirmed' is exactly "the relay answered this one already", so it is the
  // line: a row still 'reserved' belongs to a request that never delivered,
  // and retrying that is the case the design was for.
  if (!fresh && ledger.status === 'confirmed') {
    throw new AccountHttpError(
      409,
      'request_id_replayed',
      'This Alice request identifier was already answered. Send a new one.',
    );
  }

  const account = await getAccountSnapshot(env, userId);
  return {
    ledgerId: ledger.id,
    remaining: account.cloud_requests_remaining,
    used: account.cloud_requests_used,
    limit: account.cloud_requests_limit,
    duplicate: !fresh,
  };
}

export async function confirmFreeRequest(env: Env, ledgerId: string): Promise<void> {
  await env.ACCOUNT_DB.prepare(`
    UPDATE cloud_request_ledger
    SET status = 'confirmed', confirmed_at = ?
    WHERE id = ? AND status = 'reserved' AND units = 1
  `).bind(Date.now(), ledgerId).run();
}

export async function refundFreeRequest(
  env: Env,
  ledgerId: string,
  failureCode: string,
): Promise<void> {
  const now = Date.now();
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      UPDATE usage_counters
      SET
        free_cloud_requests_used = MAX(0, free_cloud_requests_used - 1),
        version = version + 1,
        updated_at = ?
      WHERE user_id = (
        SELECT user_id FROM cloud_request_ledger
        WHERE id = ? AND status = 'reserved' AND units = 1
      )
    `).bind(now, ledgerId),
    env.ACCOUNT_DB.prepare(`
      UPDATE cloud_request_ledger
      SET status = 'refunded', refunded_at = ?, failure_code = ?
      WHERE id = ? AND status = 'reserved' AND units = 1
    `).bind(now, failureCode.slice(0, 64), ledgerId),
  ]);
}

export async function cleanupExpiredAccountData(
  env: Env,
  now = Date.now(),
): Promise<void> {
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      DELETE FROM email_challenges
      WHERE expires_at < ?
    `).bind(now),
    env.ACCOUNT_DB.prepare(`
      DELETE FROM auth_challenges
      WHERE expires_at < ?
        OR (consumed_at IS NOT NULL AND consumed_at < ?)
    `).bind(now, now - EXPIRED_SESSION_RETENTION_MS),
    env.ACCOUNT_DB.prepare(`
      DELETE FROM auth_rate_limits
      WHERE expires_at < ?
    `).bind(now),
    env.ACCOUNT_DB.prepare(`
      DELETE FROM username_history
      WHERE reserved_until < ?
    `).bind(now),
    env.ACCOUNT_DB.prepare(`
      DELETE FROM sessions
      WHERE
        refresh_expires_at < ?
        OR (revoked_at IS NOT NULL AND revoked_at < ?)
    `).bind(
      now - EXPIRED_SESSION_RETENTION_MS,
      now - REVOKED_SESSION_RETENTION_MS,
    ),
    env.ACCOUNT_DB.prepare(`
      DELETE FROM installations
      WHERE last_seen_at < ?
        AND NOT EXISTS (
          SELECT 1
          FROM user_installations
          WHERE user_installations.install_id_hash = installations.install_id_hash
        )
    `).bind(now - ORPHAN_INSTALLATION_RETENTION_MS),
  ]);
}
