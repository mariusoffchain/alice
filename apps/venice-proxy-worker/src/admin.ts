// Alice admin dashboard API.
//
// Everything here is read by Alice staff, not by end users or the public
// client apps. The rules that make this safe to expose at all:
//   - every route requires a normal Alice session (authenticate()) AND a row
//     in admin_users for that session's user — there is no separate "admin
//     token" and no frontend-only flag anywhere in this file
//   - conversations, prompts, AI responses, wallet seeds/keys/transactions,
//     passwords, password hashes, and raw IP addresses are never read,
//     returned, or logged by any function below
//   - every state-changing action writes one admin_audit_log row before (for
//     destructive actions) or after (for additive ones) it happens, and that
//     row never carries a secret or free-text user content
//   - emails are masked by default; nothing here reconstructs a raw email

import type { Env } from './index.ts';
import {
  AccountHttpError,
  authenticate,
  constantTimeEqual,
  getAccountSnapshot,
  hmac,
  normalizeEmail,
  parseAppVersion,
  parsePlatform,
  rateLimit,
  requestIpBucket,
  uuid,
  verifyPasswordFor,
  type AuthenticatedUser,
} from './account.ts';
import { testWalletFaucetStatus } from './test-wallet-faucet.ts';

const ADMIN_ACCOUNTS_PAGE_SIZE = 25;
const ADMIN_AUDIT_PAGE_SIZE = 50;
const MAX_CREDIT_ADJUSTMENT = 1000;
const MAX_REASON_LENGTH = 200;
const PROMO_CODE_MAX_CHARS = 32;
const ADMIN_LOGIN_AUDIT_WINDOW_MS = 30 * 60 * 1_000;

type AdminAction =
  | 'admin_login'
  | 'admin_bootstrap'
  | 'view_account'
  | 'suspend_account'
  | 'reactivate_account'
  | 'adjust_credits'
  | 'delete_account'
  | 'promote_admin'
  | 'demote_admin'
  | 'create_promo'
  | 'disable_promo';

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
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

async function writeAuditLog(
  env: Env,
  actorUserId: string,
  action: AdminAction,
  target: { userId?: string | null; supportId?: string | null } = {},
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await env.ACCOUNT_DB.prepare(`
    INSERT INTO admin_audit_log (
      id, actor_user_id, action, target_user_id, target_support_id,
      metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    uuid(),
    actorUserId,
    action,
    target.userId ?? null,
    target.supportId ?? null,
    JSON.stringify(metadata).slice(0, 2_000),
    Date.now(),
  ).run();
}

/**
 * Best-effort, aggregate-only technical telemetry. Never throws — a
 * telemetry write must never turn a real error response into a different
 * error. `userId` must come from an already-authenticated session, never
 * from IP or install id, so this never becomes a new tracking surface.
 */
export async function recordTechnicalEvent(
  env: Env,
  category: 'auth' | 'email' | 'venice',
  code: string,
  status: number,
  userId: string | null = null,
): Promise<void> {
  if (!env.ACCOUNT_DB) return;
  try {
    await env.ACCOUNT_DB.prepare(`
      INSERT INTO technical_events (id, category, code, status, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(uuid(), category, code.slice(0, 64), status, userId, Date.now()).run();
  } catch {
    // Telemetry is best-effort.
  }
}

async function recordAccessDenial(
  env: Env,
  userId: string | null,
  reason: 'not_admin' | 'insufficient_role' | 'reauth_failed',
  path: string,
): Promise<void> {
  try {
    await env.ACCOUNT_DB.prepare(`
      INSERT INTO admin_access_denials (id, user_id, reason, path, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(uuid(), userId, reason, path.slice(0, 120), Date.now()).run();
  } catch {
    // Never let the denial record change the response.
  }
}

type AdminUser = AuthenticatedUser & { role: 'admin' | 'support' };

/**
 * Requires a valid Alice session AND a row in admin_users.
 *
 * `minimumRole` defaults to 'support' (read access). Pass 'admin' for any
 * route that changes state — a support-tier operator is refused there.
 */
/**
 * Optional second gate, independent of the database.
 *
 * When ADMIN_ALLOWED_USERNAMES is set, a session must ALSO match one of the
 * listed usernames to be treated as an admin — a row in `admin_users` is no
 * longer sufficient on its own. This is defence in depth: it means a rogue
 * or accidental promotion, or a write to D1 by anything other than this
 * Worker, still does not grant dashboard access. Leaving it unset keeps the
 * database as the single source of truth.
 */
function envAdminAllowlist(env: Env): Set<string> | null {
  const raw = env.ADMIN_ALLOWED_USERNAMES?.trim();
  if (!raw) return null;
  const names = raw.split(',').map(name => name.trim().toLowerCase()).filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

async function requireAdmin(
  request: Request,
  env: Env,
  minimumRole: 'support' | 'admin' = 'support',
): Promise<AdminUser> {
  const user = await authenticate(request, env);
  const path = new URL(request.url).pathname;
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT admin_users.role AS role, users.username AS username
    FROM admin_users
    JOIN users ON users.id = admin_users.user_id
    WHERE admin_users.user_id = ?
  `).bind(user.userId).first<{ role: 'admin' | 'support'; username: string | null }>();
  if (!row) {
    await recordAccessDenial(env, user.userId, 'not_admin', path);
    throw new AccountHttpError(403, 'admin_required', 'Alice admin access is required.');
  }
  const allowlist = envAdminAllowlist(env);
  if (allowlist && !allowlist.has((row.username ?? '').toLowerCase())) {
    await recordAccessDenial(env, user.userId, 'not_admin', path);
    throw new AccountHttpError(403, 'admin_required', 'Alice admin access is required.');
  }
  if (minimumRole === 'admin' && row.role !== 'admin') {
    await recordAccessDenial(env, user.userId, 'insufficient_role', path);
    throw new AccountHttpError(
      403,
      'admin_role_required',
      'This action requires a full admin, not a support operator.',
    );
  }
  return { ...user, role: row.role };
}

/**
 * Re-confirm an admin's password before an irreversible action, so a stolen
 * or forgotten-open session alone cannot delete an account or change who is
 * an admin. Rate-limited per admin so it cannot be used as a password
 * oracle.
 */
async function requireRecentPassword(
  request: Request,
  env: Env,
  admin: AdminUser,
  body: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  await rateLimit(env, await hmac(env, `admin-reauth:${admin.userId}`), 'admin_reauth', 10, now);
  const ok = await verifyPasswordFor(env, admin.userId, body.admin_password);
  if (!ok) {
    await recordAccessDenial(env, admin.userId, 'reauth_failed', new URL(request.url).pathname);
    throw new AccountHttpError(
      403,
      'reauth_required',
      'Re-enter your admin password to confirm this action.',
    );
  }
}

async function supportIdFor(env: Env, userId: string): Promise<string | null> {
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT username FROM users WHERE id = ?
  `).bind(userId).first<{ username: string | null }>();
  return row?.username ?? userId;
}

export async function adminBootstrap(request: Request, env: Env) {
  const user = await authenticate(request, env);
  const now = Date.now();
  // Brute-forcing a 48-byte secret is infeasible, but rate limiting keeps a
  // misconfigured (short) secret from being guessable and caps the noise.
  await rateLimit(env, await requestIpBucket(request, env, now), 'admin_bootstrap', 10, now);

  const secret = env.ADMIN_BOOTSTRAP_SECRET;
  if (!secret || secret.length < 32) {
    throw new AccountHttpError(
      500,
      'admin_bootstrap_not_configured',
      'Admin bootstrap is not configured.',
    );
  }
  const provided = request.headers.get('x-admin-bootstrap-secret') ?? '';
  if (!provided || !constantTimeEqual(provided, secret)) {
    await recordAccessDenial(env, user.userId, 'reauth_failed', '/admin/api/bootstrap');
    throw new AccountHttpError(403, 'invalid_bootstrap_secret', 'Invalid bootstrap secret.');
  }
  // Conditional insert rather than check-then-insert: two concurrent
  // bootstrap calls from different accounts would otherwise both observe an
  // empty table and both become admin.
  const inserted = await env.ACCOUNT_DB.prepare(`
    INSERT INTO admin_users (user_id, role, granted_by, granted_at)
    SELECT ?, 'admin', ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM admin_users)
  `).bind(user.userId, user.userId, now).run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    throw new AccountHttpError(
      409,
      'admin_already_bootstrapped',
      'Alice already has an admin account. Ask an existing admin to promote you.',
    );
  }
  await writeAuditLog(env, user.userId, 'admin_bootstrap', { userId: user.userId });
  return { ok: true };
}

export async function adminSession(request: Request, env: Env) {
  const user = await requireAdmin(request, env);
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT username, display_name FROM users WHERE id = ?
  `).bind(user.userId).first<{ username: string | null; display_name: string | null }>();
  // The dashboard calls this on every page load. Collapse repeats into one
  // entry per session window, otherwise admin_login floods the audit log and
  // buries the entries that actually matter.
  const recent = await env.ACCOUNT_DB.prepare(`
    SELECT 1 AS found FROM admin_audit_log
    WHERE actor_user_id = ? AND action = 'admin_login' AND created_at > ?
    LIMIT 1
  `).bind(user.userId, Date.now() - ADMIN_LOGIN_AUDIT_WINDOW_MS).first<{ found: number }>();
  if (!recent) await writeAuditLog(env, user.userId, 'admin_login');
  return {
    username: row?.username ?? null,
    display_name: row?.display_name ?? null,
    role: user.role,
  };
}

type OverviewCounts = {
  accounts_created: number;
  installations_anonymous: number;
  requests_24h: number;
  requests_7d: number;
  requests_30d: number;
  accounts_with_free_usage: number;
  accounts_at_quota: number;
  free_requests_used_total: number;
  plans: { plan: string; count: number }[];
  auth_errors_24h: number;
  email_errors_24h: number;
  venice_errors_24h: number;
};

/**
 * A period-over-period change, as a percentage. Returns null rather than a
 * misleading number when the previous period had nothing to compare against —
 * "+100%" from a base of zero says less than "no basis for comparison".
 */
function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Fill gaps with zeros so a sparse series does not read as a continuous one. */
function densify(
  rows: { day: number; count: number }[],
  days: number,
  today: number,
): { day: number; count: number }[] {
  const byDay = new Map(rows.map(row => [row.day, row.count]));
  const out: { day: number; count: number }[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = today - offset;
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

export async function adminOverview(request: Request, env: Env) {
  await requireAdmin(request, env);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1_000;
  const today = Math.floor(now / day);
  const since30 = now - 30 * day;

  const [
    accounts,
    installs,
    requests,
    quotaRow,
    plans,
    errors,
    requestSeries,
    installSeries,
    accountSeries,
  ] = await Promise.all([
    // An account is a user holding at least one identity. Judging by the id
    // shape stopped working when creation began graduating the anonymous
    // user in place, anon_ id and all; the identity's date is the account's
    // birthday, since that is the moment it became somebody's.
    env.ACCOUNT_DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN first_at > ? THEN 1 ELSE 0 END) AS last_7d,
        SUM(CASE WHEN first_at > ? AND first_at <= ? THEN 1 ELSE 0 END) AS prev_7d
      FROM (
        SELECT user_id, MIN(created_at) AS first_at
        FROM user_identities GROUP BY user_id
      )
    `).bind(now - 7 * day, now - 14 * day, now - 7 * day)
      .first<{ total: number; last_7d: number; prev_7d: number }>(),

    // Two different things, deliberately kept apart: how many devices have
    // Alice at all, and how many sessions were never tied to an account.
    // Collapsing them into one "installations" figure is how a dashboard
    // starts lying.
    env.ACCOUNT_DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM installations) AS total,
        (SELECT COUNT(*) FROM users WHERE NOT EXISTS (
          SELECT 1 FROM user_identities WHERE user_identities.user_id = users.id
        )) AS anonymous,
        (SELECT COUNT(*) FROM installations WHERE first_seen_at > ?) AS last_7d,
        (SELECT COUNT(*) FROM installations
          WHERE first_seen_at > ? AND first_seen_at <= ?) AS prev_7d,
        (SELECT COUNT(*) FROM installations WHERE last_seen_at > ?) AS active_7d
    `).bind(now - 7 * day, now - 14 * day, now - 7 * day, now - 7 * day)
      .first<{
        total: number; anonymous: number;
        last_7d: number; prev_7d: number; active_7d: number;
      }>(),

    env.ACCOUNT_DB.prepare(`
      SELECT
        SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS last_24h,
        SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS last_7d,
        SUM(CASE WHEN created_at > ? AND created_at <= ? THEN 1 ELSE 0 END) AS prev_7d,
        SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS last_30d,
        COUNT(*) AS total
      FROM cloud_request_ledger WHERE status = 'confirmed'
    `).bind(now - day, now - 7 * day, now - 14 * day, now - 7 * day, since30)
      .first<Record<string, number>>(),

    env.ACCOUNT_DB.prepare(`
      SELECT
        SUM(CASE WHEN u.free_cloud_requests_used > 0 THEN 1 ELSE 0 END) AS with_usage,
        SUM(CASE WHEN e.free_cloud_requests_limit > 0
                  AND u.free_cloud_requests_used >= e.free_cloud_requests_limit
                 THEN 1 ELSE 0 END) AS at_quota,
        COALESCE(SUM(u.free_cloud_requests_used), 0) AS total_used
      FROM usage_counters u
      JOIN entitlements e ON e.user_id = u.user_id
    `).first<{ with_usage: number; at_quota: number; total_used: number }>(),

    env.ACCOUNT_DB.prepare('SELECT plan, COUNT(*) AS count FROM entitlements GROUP BY plan')
      .all<{ plan: string; count: number }>(),

    env.ACCOUNT_DB.prepare(`
      SELECT category, COUNT(*) AS count FROM technical_events
      WHERE created_at > ? GROUP BY category
    `).bind(now - day).all<{ category: string; count: number }>(),

    env.ACCOUNT_DB.prepare(`
      SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS count FROM cloud_request_ledger
      WHERE status = 'confirmed' AND created_at > ? GROUP BY day ORDER BY day ASC
    `).bind(since30).all<{ day: number; count: number }>(),

    env.ACCOUNT_DB.prepare(`
      SELECT CAST(first_seen_at / 86400000 AS INTEGER) AS day, COUNT(*) AS count FROM installations
      WHERE first_seen_at > ? GROUP BY day ORDER BY day ASC
    `).bind(since30).all<{ day: number; count: number }>(),

    env.ACCOUNT_DB.prepare(`
      SELECT CAST(first_at / 86400000 AS INTEGER) AS day, COUNT(*) AS count FROM (
        SELECT user_id, MIN(created_at) AS first_at
        FROM user_identities GROUP BY user_id
      ) WHERE first_at > ? GROUP BY day ORDER BY day ASC
    `).bind(since30).all<{ day: number; count: number }>(),
  ]);

  const errorsByCategory = Object.fromEntries(
    (errors.results ?? []).map(row => [row.category, row.count]),
  );

  return {
    // Headline figures, each with its own 7-day trend.
    accounts_created: accounts?.total ?? 0,
    accounts_created_7d: accounts?.last_7d ?? 0,
    accounts_change_percent: changePercent(accounts?.last_7d ?? 0, accounts?.prev_7d ?? 0),

    installations_total: installs?.total ?? 0,
    installations_anonymous: installs?.anonymous ?? 0,
    installations_7d: installs?.last_7d ?? 0,
    installations_active_7d: installs?.active_7d ?? 0,
    installations_change_percent: changePercent(installs?.last_7d ?? 0, installs?.prev_7d ?? 0),

    requests_24h: requests?.last_24h ?? 0,
    requests_7d: requests?.last_7d ?? 0,
    requests_30d: requests?.last_30d ?? 0,
    requests_total: requests?.total ?? 0,
    requests_change_percent: changePercent(requests?.last_7d ?? 0, requests?.prev_7d ?? 0),

    accounts_with_free_usage: quotaRow?.with_usage ?? 0,
    accounts_at_quota: quotaRow?.at_quota ?? 0,
    free_requests_used_total: quotaRow?.total_used ?? 0,

    plans: plans.results ?? [],
    auth_errors_24h: errorsByCategory.auth ?? 0,
    email_errors_24h: errorsByCategory.email ?? 0,
    venice_errors_24h: errorsByCategory.venice ?? 0,

    // Daily series, gap-filled so the curves are honest about quiet days.
    series: {
      requests: densify(requestSeries.results ?? [], 30, today),
      installations: densify(installSeries.results ?? [], 30, today),
      accounts: densify(accountSeries.results ?? [], 30, today),
    },
  };
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Everything here is a COUNT or a SUM over rows Alice already stores. No
 * per-individual series is produced or returned: retention and the funnel
 * are computed from installation-level milestones and collapsed to totals
 * before they leave the database.
 */
export async function adminAnalytics(request: Request, env: Env) {
  await requireAdmin(request, env);
  const now = Date.now();

  const [retention, funnel, quota, requestsByDay, errorsByCode, reliability, platforms] =
    await Promise.all([
      // An install counts as retained at D_n when it was still seen at least
      // n days after it first appeared. Cohort eligibility is applied per
      // horizon so a two-day-old install never drags down D30.
      env.ACCOUNT_DB.prepare(`
        SELECT
          SUM(CASE WHEN first_seen_at <= ? THEN 1 ELSE 0 END) AS eligible_d1,
          SUM(CASE WHEN first_seen_at <= ? AND last_seen_at - first_seen_at >= ? THEN 1 ELSE 0 END) AS retained_d1,
          SUM(CASE WHEN first_seen_at <= ? THEN 1 ELSE 0 END) AS eligible_d7,
          SUM(CASE WHEN first_seen_at <= ? AND last_seen_at - first_seen_at >= ? THEN 1 ELSE 0 END) AS retained_d7,
          SUM(CASE WHEN first_seen_at <= ? THEN 1 ELSE 0 END) AS eligible_d30,
          SUM(CASE WHEN first_seen_at <= ? AND last_seen_at - first_seen_at >= ? THEN 1 ELSE 0 END) AS retained_d30
        FROM installations
      `).bind(
        now - DAY_MS, now - DAY_MS, DAY_MS,
        now - 7 * DAY_MS, now - 7 * DAY_MS, 7 * DAY_MS,
        now - 30 * DAY_MS, now - 30 * DAY_MS, 30 * DAY_MS,
      ).first<Record<string, number>>(),

      // Milestones are write-once and only started being recorded when
      // migration 0007 landed. Installations older than that have NULL for
      // every step, which would read as "nobody ever made a request" rather
      // than "we were not measuring yet". Report the tracked subset and the
      // date tracking began so the funnel can say which it is.
      env.ACCOUNT_DB.prepare(`
        SELECT
          COUNT(*) AS installs,
          SUM(CASE WHEN first_cloud_request_at IS NOT NULL THEN 1 ELSE 0 END) AS made_first_request,
          SUM(CASE WHEN tenth_cloud_request_at IS NOT NULL THEN 1 ELSE 0 END) AS made_ten_requests,
          SUM(CASE WHEN quota_exhausted_at IS NOT NULL THEN 1 ELSE 0 END) AS exhausted_quota,
          SUM(CASE WHEN account_created_at IS NOT NULL THEN 1 ELSE 0 END) AS created_account,
          SUM(CASE
            WHEN first_cloud_request_at IS NOT NULL
              OR account_created_at IS NOT NULL
              OR platform IS NOT NULL
            THEN 1 ELSE 0
          END) AS tracked,
          MIN(COALESCE(first_cloud_request_at, account_created_at)) AS tracking_since
        FROM installations
      `).first<Record<string, number | null>>(),

      env.ACCOUNT_DB.prepare(`
        SELECT
          SUM(CASE WHEN u.free_cloud_requests_used = 0 THEN 1 ELSE 0 END) AS used_none,
          SUM(CASE WHEN u.free_cloud_requests_used BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS used_1_5,
          SUM(CASE WHEN u.free_cloud_requests_used BETWEEN 6 AND 10 THEN 1 ELSE 0 END) AS used_6_10,
          SUM(CASE WHEN u.free_cloud_requests_used BETWEEN 11 AND 20 THEN 1 ELSE 0 END) AS used_11_20,
          SUM(CASE WHEN e.free_cloud_requests_limit > 0
                    AND u.free_cloud_requests_used >= e.free_cloud_requests_limit
                   THEN 1 ELSE 0 END) AS exhausted
        FROM usage_counters u
        JOIN entitlements e ON e.user_id = u.user_id
      `).first<Record<string, number>>(),

      env.ACCOUNT_DB.prepare(`
        SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS count
        FROM cloud_request_ledger
        WHERE status = 'confirmed' AND created_at > ?
        GROUP BY day
        ORDER BY day ASC
      `).bind(now - 30 * DAY_MS).all<{ day: number; count: number }>(),

      env.ACCOUNT_DB.prepare(`
        SELECT category, code, COUNT(*) AS count
        FROM technical_events
        WHERE created_at > ?
        GROUP BY category, code
        ORDER BY count DESC
        LIMIT 25
      `).bind(now - 7 * DAY_MS).all<{ category: string; code: string; count: number }>(),

      env.ACCOUNT_DB.prepare(`
        SELECT status, COUNT(*) AS count
        FROM cloud_request_ledger
        WHERE created_at > ?
        GROUP BY status
      `).bind(now - 7 * DAY_MS).all<{ status: string; count: number }>(),

      env.ACCOUNT_DB.prepare(`
        SELECT
          COALESCE(platform, 'unknown') AS platform,
          COALESCE(app_version, 'unknown') AS app_version,
          COUNT(*) AS count
        FROM installations
        GROUP BY platform, app_version
        ORDER BY count DESC
        LIMIT 50
      `).all<{ platform: string; app_version: string; count: number }>(),
    ]);

  function rate(retained: number | undefined, eligible: number | undefined): number | null {
    if (!eligible) return null;
    return Math.round(((retained ?? 0) / eligible) * 1000) / 10;
  }

  return {
    retention: {
      d1: { eligible: retention?.eligible_d1 ?? 0, retained: retention?.retained_d1 ?? 0, percent: rate(retention?.retained_d1, retention?.eligible_d1) },
      d7: { eligible: retention?.eligible_d7 ?? 0, retained: retention?.retained_d7 ?? 0, percent: rate(retention?.retained_d7, retention?.eligible_d7) },
      d30: { eligible: retention?.eligible_d30 ?? 0, retained: retention?.retained_d30 ?? 0, percent: rate(retention?.retained_d30, retention?.eligible_d30) },
    },
    funnel: {
      installs: funnel?.installs ?? 0,
      made_first_request: funnel?.made_first_request ?? 0,
      made_ten_requests: funnel?.made_ten_requests ?? 0,
      exhausted_quota: funnel?.exhausted_quota ?? 0,
      created_account: funnel?.created_account ?? 0,
      tracked: funnel?.tracked ?? 0,
      tracking_since: funnel?.tracking_since ?? null,
    },
    quota_histogram: {
      used_none: quota?.used_none ?? 0,
      used_1_5: quota?.used_1_5 ?? 0,
      used_6_10: quota?.used_6_10 ?? 0,
      used_11_20: quota?.used_11_20 ?? 0,
      exhausted: quota?.exhausted ?? 0,
    },
    requests_by_day: requestsByDay.results ?? [],
    errors_by_code: errorsByCode.results ?? [],
    reliability: reliability.results ?? [],
    platforms: platforms.results ?? [],
  };
}

type AccountListRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  email_masked: string | null;
  status: string;
  plan: string;
  created_at: number;
  free_cloud_requests_limit: number;
  free_cloud_requests_used: number;
};

export async function adminListAccounts(request: Request, env: Env) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const rawQuery = (url.searchParams.get('q') ?? '').trim();
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0') || 0);

  const baseSelect = `
    SELECT
      users.id AS user_id,
      users.username AS username,
      users.display_name AS display_name,
      (
        SELECT display_label FROM user_identities
        WHERE user_identities.user_id = users.id AND user_identities.provider = 'email'
        ORDER BY created_at ASC LIMIT 1
      ) AS email_masked,
      users.status AS status,
      entitlements.plan AS plan,
      users.created_at AS created_at,
      entitlements.free_cloud_requests_limit AS free_cloud_requests_limit,
      usage_counters.free_cloud_requests_used AS free_cloud_requests_used
    FROM users
    JOIN entitlements ON entitlements.user_id = users.id
    JOIN usage_counters ON usage_counters.user_id = users.id
    WHERE EXISTS (
      SELECT 1 FROM user_identities WHERE user_identities.user_id = users.id
    )
  `;

  let rows: { results: AccountListRow[] };
  if (!rawQuery) {
    rows = await env.ACCOUNT_DB.prepare(`
      ${baseSelect}
      ORDER BY users.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(ADMIN_ACCOUNTS_PAGE_SIZE, offset).all<AccountListRow>();
  } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawQuery)) {
    // Partial-email search still requires the exact masked local part or a
    // full valid email; we never do substring search on the plaintext email
    // because Alice does not store it. An exact email is hashed and matched.
    const emailLookup = await hmac(env, `email:${normalizeEmail(rawQuery)}`);
    rows = await env.ACCOUNT_DB.prepare(`
      ${baseSelect}
        AND users.id IN (
          SELECT user_id FROM user_identities
          WHERE provider = 'email' AND provider_subject = ?
        )
      ORDER BY users.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(emailLookup, ADMIN_ACCOUNTS_PAGE_SIZE, offset).all<AccountListRow>();
  } else {
    const like = `%${rawQuery.toLowerCase().replace(/[%_]/g, char => `\\${char}`)}%`;
    rows = await env.ACCOUNT_DB.prepare(`
      ${baseSelect}
        AND (
          LOWER(users.username) LIKE ? ESCAPE '\\'
          OR LOWER(users.id) LIKE ? ESCAPE '\\'
        )
      ORDER BY users.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(like, like, ADMIN_ACCOUNTS_PAGE_SIZE, offset).all<AccountListRow>();
  }

  return {
    accounts: rows.results.map(row => ({
      support_id: row.username ?? row.user_id,
      username: row.username,
      display_name: row.display_name,
      email_masked: row.email_masked,
      status: row.status,
      plan: row.plan,
      created_at: row.created_at,
      cloud_requests_limit: row.free_cloud_requests_limit,
      cloud_requests_used: row.free_cloud_requests_used,
    })),
    next_offset: rows.results.length === ADMIN_ACCOUNTS_PAGE_SIZE ? offset + ADMIN_ACCOUNTS_PAGE_SIZE : null,
  };
}

async function resolveAccountId(env: Env, idOrUsername: string): Promise<string> {
  const direct = await env.ACCOUNT_DB.prepare(`
    SELECT id FROM users WHERE id = ? AND EXISTS (
      SELECT 1 FROM user_identities WHERE user_identities.user_id = users.id
    )
  `).bind(idOrUsername).first<{ id: string }>();
  if (direct) return direct.id;
  const byUsername = await env.ACCOUNT_DB.prepare(`
    SELECT id FROM users WHERE username = ?
  `).bind(idOrUsername.toLowerCase()).first<{ id: string }>();
  if (byUsername) return byUsername.id;
  throw new AccountHttpError(404, 'account_not_found', 'Alice account not found.');
}

export async function adminGetAccount(request: Request, env: Env, idOrUsername: string) {
  const admin = await requireAdmin(request, env);
  const userId = await resolveAccountId(env, idOrUsername);
  const snapshot = await getAccountSnapshot(env, userId);

  const lastActivity = await env.ACCOUNT_DB.prepare(`
    SELECT MAX(last_used_at) AS last_used_at FROM sessions WHERE user_id = ?
  `).bind(userId).first<{ last_used_at: number | null }>();

  const recentErrors = await env.ACCOUNT_DB.prepare(`
    SELECT category, code, status, created_at FROM technical_events
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(userId).all<{ category: string; code: string; status: number; created_at: number }>();

  await writeAuditLog(env, admin.userId, 'view_account', {
    userId,
    supportId: snapshot.username ?? userId,
  });

  return {
    support_id: snapshot.username ?? snapshot.user_id,
    username: snapshot.username,
    display_name: snapshot.display_name,
    email_masked: snapshot.email_masked,
    status: snapshot.status,
    plan: snapshot.plan,
    cloud_enabled: snapshot.cloud_enabled,
    cloud_requests_limit: snapshot.cloud_requests_limit,
    cloud_requests_used: snapshot.cloud_requests_used,
    cloud_requests_remaining: snapshot.cloud_requests_remaining,
    login_methods: snapshot.identities.map(identity => ({
      provider: identity.provider,
      label: identity.display_label,
      created_at: identity.created_at,
      last_used_at: identity.last_used_at,
    })),
    last_activity_at: lastActivity?.last_used_at ?? null,
    recent_errors: recentErrors.results ?? [],
    // Internal id is included only for operators who need it to act via this
    // API; the account's own users never see it. See docs/security/admin.md.
    internal_id: snapshot.user_id,
  };
}

function readReason(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    throw new AccountHttpError(400, 'reason_required', 'A short reason is required.');
  }
  return reason.slice(0, MAX_REASON_LENGTH);
}

export async function adminSuspendAccount(request: Request, env: Env, idOrUsername: string) {
  const admin = await requireAdmin(request, env, 'admin');
  const body = await parseJsonBody(request);
  const reason = readReason(body);
  const userId = await resolveAccountId(env, idOrUsername);
  const now = Date.now();
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      UPDATE users SET status = 'suspended', updated_at = ?
      WHERE id = ? AND status = 'active'
    `).bind(now, userId),
    env.ACCOUNT_DB.prepare(`
      UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
    `).bind(now, userId),
  ]);
  const supportId = await supportIdFor(env, userId);
  await writeAuditLog(env, admin.userId, 'suspend_account', { userId, supportId }, { reason });
  return { ok: true };
}

export async function adminReactivateAccount(request: Request, env: Env, idOrUsername: string) {
  const admin = await requireAdmin(request, env, 'admin');
  const body = await parseJsonBody(request);
  const reason = readReason(body);
  const userId = await resolveAccountId(env, idOrUsername);
  await env.ACCOUNT_DB.prepare(`
    UPDATE users SET status = 'active', updated_at = ?
    WHERE id = ? AND status = 'suspended'
  `).bind(Date.now(), userId).run();
  const supportId = await supportIdFor(env, userId);
  await writeAuditLog(env, admin.userId, 'reactivate_account', { userId, supportId }, { reason });
  return { ok: true };
}

export async function adminAdjustCredits(request: Request, env: Env, idOrUsername: string) {
  const admin = await requireAdmin(request, env, 'admin');
  const body = await parseJsonBody(request);
  const reason = readReason(body);
  const delta = Number(body.delta);
  if (
    !Number.isInteger(delta)
    || delta === 0
    || Math.abs(delta) > MAX_CREDIT_ADJUSTMENT
  ) {
    throw new AccountHttpError(
      400,
      'invalid_delta',
      `delta must be a non-zero integer with an absolute value up to ${MAX_CREDIT_ADJUSTMENT}.`,
    );
  }
  const userId = await resolveAccountId(env, idOrUsername);
  const current = await env.ACCOUNT_DB.prepare(`
    SELECT entitlements.free_cloud_requests_limit AS limit_now,
           usage_counters.free_cloud_requests_used AS used_now
    FROM entitlements
    JOIN usage_counters ON usage_counters.user_id = entitlements.user_id
    WHERE entitlements.user_id = ?
  `).bind(userId).first<{ limit_now: number; used_now: number }>();
  if (!current) {
    throw new AccountHttpError(404, 'account_not_found', 'Alice account not found.');
  }
  const nextLimit = Math.max(current.used_now, current.limit_now + delta);
  await env.ACCOUNT_DB.prepare(`
    UPDATE entitlements SET free_cloud_requests_limit = ?, updated_at = ?
    WHERE user_id = ?
  `).bind(nextLimit, Date.now(), userId).run();
  const supportId = await supportIdFor(env, userId);
  await writeAuditLog(
    env,
    admin.userId,
    'adjust_credits',
    { userId, supportId },
    { delta, reason, previous_limit: current.limit_now, new_limit: nextLimit },
  );
  return { cloud_requests_limit: nextLimit };
}

export async function adminDeleteAccount(request: Request, env: Env, idOrUsername: string) {
  const admin = await requireAdmin(request, env, 'admin');
  const body = await parseJsonBody(request);
  await requireRecentPassword(request, env, admin, body);
  const userId = await resolveAccountId(env, idOrUsername);
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT username FROM users WHERE id = ?
  `).bind(userId).first<{ username: string | null }>();
  const supportId = row?.username ?? userId;
  const confirmation = typeof body.confirm === 'string' ? body.confirm.trim() : '';
  if (!confirmation || confirmation !== supportId) {
    throw new AccountHttpError(
      400,
      'confirmation_mismatch',
      'Type the account\'s exact support id to confirm permanent deletion.',
    );
  }

  // Logged before the row disappears; target_support_id keeps the trail
  // readable afterward even though target_user_id will read NULL.
  await writeAuditLog(env, admin.userId, 'delete_account', { userId, supportId }, {});

  // Explicit ordered delete rather than relying on ON DELETE CASCADE being
  // enforced for this connection — correct regardless of D1's per-connection
  // foreign_keys pragma state.
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare('DELETE FROM promo_redemptions WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM admin_users WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM cloud_request_ledger WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM free_grants WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM user_installations WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM passkey_credentials WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM password_credentials WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM user_identities WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM usage_counters WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('DELETE FROM entitlements WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare('UPDATE technical_events SET user_id = NULL WHERE user_id = ?').bind(userId),
    env.ACCOUNT_DB.prepare(`
      UPDATE username_history SET released_at = ? WHERE user_id = ?
    `).bind(Date.now(), userId),
    env.ACCOUNT_DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
  return { ok: true };
}

export async function adminListAdmins(request: Request, env: Env) {
  await requireAdmin(request, env);
  const rows = await env.ACCOUNT_DB.prepare(`
    SELECT admin_users.user_id AS user_id, users.username AS username,
           admin_users.role AS role, admin_users.granted_at AS granted_at
    FROM admin_users
    JOIN users ON users.id = admin_users.user_id
    ORDER BY admin_users.granted_at ASC
  `).all<{ user_id: string; username: string | null; role: string; granted_at: number }>();
  return {
    admins: rows.results.map(row => ({
      support_id: row.username ?? row.user_id,
      role: row.role,
      granted_at: row.granted_at,
    })),
  };
}

/** Recent denied attempts to reach the dashboard, so probing is visible. */
export async function adminListAccessDenials(request: Request, env: Env) {
  await requireAdmin(request, env);
  const rows = await env.ACCOUNT_DB.prepare(`
    SELECT admin_access_denials.reason AS reason,
           admin_access_denials.path AS path,
           admin_access_denials.created_at AS created_at,
           users.username AS username
    FROM admin_access_denials
    LEFT JOIN users ON users.id = admin_access_denials.user_id
    ORDER BY admin_access_denials.created_at DESC
    LIMIT 50
  `).all<{ reason: string; path: string; created_at: number; username: string | null }>();
  return {
    denials: rows.results.map(row => ({
      reason: row.reason,
      path: row.path,
      created_at: row.created_at,
      support_id: row.username ?? 'unknown',
    })),
  };
}

export async function adminPromote(request: Request, env: Env) {
  const admin = await requireAdmin(request, env, 'admin');
  const body = await parseJsonBody(request);
  await requireRecentPassword(request, env, admin, body);
  const target = typeof body.account === 'string' ? body.account.trim() : '';
  if (!target) {
    throw new AccountHttpError(400, 'invalid_account', 'account is required.');
  }
  const role = body.role === 'support' ? 'support' : 'admin';
  const userId = await resolveAccountId(env, target);
  await env.ACCOUNT_DB.prepare(`
    INSERT INTO admin_users (user_id, role, granted_by, granted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET role = excluded.role
  `).bind(userId, role, admin.userId, Date.now()).run();
  const supportId = await supportIdFor(env, userId);
  await writeAuditLog(env, admin.userId, 'promote_admin', { userId, supportId }, { role });
  return { ok: true, role };
}

export async function adminDemote(request: Request, env: Env, idOrUsername: string) {
  const admin = await requireAdmin(request, env, 'admin');
  await requireRecentPassword(request, env, admin, await parseJsonBody(request));
  const userId = await resolveAccountId(env, idOrUsername);
  // Support rows do not count: demoting the last *full* admin would lock
  // the team out of every state-changing action even if read-only
  // operators remain.
  const target = await env.ACCOUNT_DB.prepare(`
    SELECT role FROM admin_users WHERE user_id = ?
  `).bind(userId).first<{ role: string }>();
  const countRow = await env.ACCOUNT_DB.prepare(`
    SELECT COUNT(*) AS count FROM admin_users WHERE role = 'admin'
  `).first<{ count: number }>();
  if (target?.role === 'admin' && (countRow?.count ?? 0) <= 1) {
    throw new AccountHttpError(
      409,
      'last_admin',
      'Alice needs at least one admin. Promote another admin first.',
    );
  }
  await env.ACCOUNT_DB.prepare('DELETE FROM admin_users WHERE user_id = ?').bind(userId).run();
  const supportId = await supportIdFor(env, userId);
  await writeAuditLog(env, admin.userId, 'demote_admin', { userId, supportId });
  return { ok: true };
}

export async function adminListAuditLog(request: Request, env: Env) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0') || 0);
  const rows = await env.ACCOUNT_DB.prepare(`
    SELECT
      admin_audit_log.id AS id,
      admin_audit_log.action AS action,
      admin_audit_log.target_support_id AS target_support_id,
      admin_audit_log.metadata AS metadata,
      admin_audit_log.created_at AS created_at,
      users.username AS actor_username,
      admin_audit_log.actor_user_id AS actor_user_id
    FROM admin_audit_log
    JOIN users ON users.id = admin_audit_log.actor_user_id
    ORDER BY admin_audit_log.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(ADMIN_AUDIT_PAGE_SIZE, offset).all<{
    id: string;
    action: string;
    target_support_id: string | null;
    metadata: string | null;
    created_at: number;
    actor_username: string | null;
    actor_user_id: string;
  }>();
  return {
    entries: rows.results.map(row => ({
      id: row.id,
      action: row.action,
      actor_support_id: row.actor_username ?? row.actor_user_id,
      target_support_id: row.target_support_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      created_at: row.created_at,
    })),
    next_offset: rows.results.length === ADMIN_AUDIT_PAGE_SIZE ? offset + ADMIN_AUDIT_PAGE_SIZE : null,
  };
}

function generatePromoCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `ALICE-${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

export async function adminListPromoCodes(request: Request, env: Env) {
  await requireAdmin(request, env);
  const rows = await env.ACCOUNT_DB.prepare(`
    SELECT code, credits, max_redemptions, redemptions_count, expires_at,
           created_at, disabled_at
    FROM promo_codes
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  return { promo_codes: rows.results ?? [] };
}

export async function adminCreatePromoCode(request: Request, env: Env) {
  const admin = await requireAdmin(request, env, 'admin');
  const body = await parseJsonBody(request);
  const credits = Number(body.credits);
  const maxRedemptions = Number(body.max_redemptions ?? 1);
  const expiresInDays = body.expires_in_days === undefined
    ? null
    : Number(body.expires_in_days);
  if (!Number.isInteger(credits) || credits <= 0 || credits > 10_000) {
    throw new AccountHttpError(400, 'invalid_credits', 'credits must be between 1 and 10000.');
  }
  if (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0 || maxRedemptions > 100_000) {
    throw new AccountHttpError(400, 'invalid_max_redemptions', 'max_redemptions is invalid.');
  }
  if (expiresInDays !== null && (!Number.isFinite(expiresInDays) || expiresInDays <= 0)) {
    throw new AccountHttpError(400, 'invalid_expiry', 'expires_in_days is invalid.');
  }
  let code = typeof body.code === 'string' && body.code.trim()
    ? body.code.trim().toUpperCase().slice(0, PROMO_CODE_MAX_CHARS)
    : generatePromoCode();
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
    throw new AccountHttpError(400, 'invalid_code', 'code must be 4-32 letters, digits or dashes.');
  }
  const now = Date.now();
  const expiresAt = expiresInDays ? now + expiresInDays * 24 * 60 * 60 * 1_000 : null;
  const inserted = await env.ACCOUNT_DB.prepare(`
    INSERT INTO promo_codes (
      code, credits, max_redemptions, redemptions_count,
      expires_at, created_by, created_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?)
    ON CONFLICT (code) DO NOTHING
  `).bind(code, credits, maxRedemptions, expiresAt, admin.userId, now).run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    throw new AccountHttpError(409, 'code_taken', 'That promo code already exists.');
  }
  await writeAuditLog(env, admin.userId, 'create_promo', {}, { code, credits, max_redemptions: maxRedemptions });
  return { code, credits, max_redemptions: maxRedemptions, expires_at: expiresAt };
}

export async function adminDisablePromoCode(request: Request, env: Env, code: string) {
  const admin = await requireAdmin(request, env, 'admin');
  const normalized = code.trim().toUpperCase();
  const updated = await env.ACCOUNT_DB.prepare(`
    UPDATE promo_codes SET disabled_at = ? WHERE code = ? AND disabled_at IS NULL
  `).bind(Date.now(), normalized).run();
  if ((updated.meta.changes ?? 0) !== 1) {
    throw new AccountHttpError(404, 'promo_not_found', 'Promo code not found or already disabled.');
  }
  await writeAuditLog(env, admin.userId, 'disable_promo', {}, { code: normalized });
  return { ok: true };
}

/**
 * The complete set of product events Alice will store. This allowlist is
 * the control that keeps `events_daily` safe: a client can only increment
 * one of these fixed counters, so no client-supplied string — and
 * therefore no user content, no search query, no file name — can ever
 * reach storage through this path.
 *
 * Nothing wallet-related belongs here. The server has no business knowing
 * a wallet exists.
 */
const ALLOWED_EVENT_NAMES = new Set([
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
]);

/**
 * User-facing analytics ingest. Requires a session (anonymous sessions
 * count) purely so the endpoint cannot be spammed by unauthenticated
 * traffic — the session identity is deliberately NOT stored with the
 * event. Only a day-resolution counter is incremented.
 */
export async function recordProductEvents(request: Request, env: Env) {
  const { userId } = await authenticate(request, env);
  const now = Date.now();
  await rateLimit(env, await hmac(env, `events:${userId}`), 'product_events', 240, now);

  const body = await parseJsonBody(request);
  const names = Array.isArray(body.events) ? body.events : [];
  if (names.length === 0 || names.length > 32) {
    throw new AccountHttpError(400, 'invalid_events', 'Send between 1 and 32 event names.');
  }
  const platform = parsePlatform(request) ?? '';
  const appVersion = parseAppVersion(request) ?? '';
  const day = Math.floor(now / (24 * 60 * 60 * 1_000));

  const counts = new Map<string, number>();
  for (const name of names) {
    if (typeof name !== 'string' || !ALLOWED_EVENT_NAMES.has(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return { accepted: 0 };

  await env.ACCOUNT_DB.batch(
    [...counts].map(([name, count]) => env.ACCOUNT_DB.prepare(`
      INSERT INTO events_daily (day, event_name, platform, app_version, count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (day, event_name, platform, app_version)
      DO UPDATE SET count = count + excluded.count
    `).bind(day, name, platform, appVersion, count)),
  );
  return { accepted: counts.size };
}

/**
 * The test wallet faucet, as the operator needs to see it: how much float is
 * left in Alice's dispensing wallet, and how fast learners are taking it.
 *
 * Read-only by construction, and read-only about the right things. The
 * recovery phrase stays in its Worker secret and is never returned, shown or
 * derivable from anything here; the only address reported is the dispensing
 * wallet's own, so topping it up needs no secret handling. No claimer, no
 * payout transaction, nothing that would point at a learner's wallet.
 */
export async function adminTestWalletFaucet(request: Request, env: Env) {
  await requireAdmin(request, env);
  return testWalletFaucetStatus(env);
}

export async function adminListEvents(request: Request, env: Env) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? '30') || 30));
  const sinceDay = Math.floor(Date.now() / (24 * 60 * 60 * 1_000)) - days;

  const [totals, byDay] = await Promise.all([
    env.ACCOUNT_DB.prepare(`
      SELECT event_name, platform, app_version, SUM(count) AS count
      FROM events_daily
      WHERE day >= ?
      GROUP BY event_name, platform, app_version
      ORDER BY count DESC
      LIMIT 200
    `).bind(sinceDay).all<{ event_name: string; platform: string; app_version: string; count: number }>(),
    env.ACCOUNT_DB.prepare(`
      SELECT day, event_name, SUM(count) AS count
      FROM events_daily
      WHERE day >= ?
      GROUP BY day, event_name
      ORDER BY day ASC
    `).bind(sinceDay).all<{ day: number; event_name: string; count: number }>(),
  ]);

  return {
    known_event_names: [...ALLOWED_EVENT_NAMES],
    totals: totals.results ?? [],
    by_day: byDay.results ?? [],
  };
}

/** User-facing: redeem a promo code for extra free Private Cloud requests. */
export async function redeemPromoCode(request: Request, env: Env) {
  const { userId } = await authenticate(request, env);
  const body = await parseJsonBody(request);
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) {
    throw new AccountHttpError(400, 'invalid_code', 'Enter a valid promo code.');
  }
  const now = Date.now();
  await rateLimit(env, await requestIpBucket(request, env, now), 'promo_redeem', 30, now);

  const promo = await env.ACCOUNT_DB.prepare(`
    SELECT credits, max_redemptions, redemptions_count, expires_at, disabled_at
    FROM promo_codes WHERE code = ?
  `).bind(code).first<{
    credits: number;
    max_redemptions: number;
    redemptions_count: number;
    expires_at: number | null;
    disabled_at: number | null;
  }>();
  if (
    !promo
    || promo.disabled_at !== null
    || (promo.expires_at !== null && promo.expires_at <= now)
    || promo.redemptions_count >= promo.max_redemptions
  ) {
    throw new AccountHttpError(400, 'invalid_promo_code', 'This promo code is not valid.');
  }

  const claimed = await env.ACCOUNT_DB.prepare(`
    INSERT INTO promo_redemptions (code, user_id, redeemed_at)
    VALUES (?, ?, ?)
    ON CONFLICT (code, user_id) DO NOTHING
  `).bind(code, userId, now).run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    throw new AccountHttpError(409, 'promo_already_redeemed', 'You already redeemed this promo code.');
  }

  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      UPDATE promo_codes
      SET redemptions_count = redemptions_count + 1
      WHERE code = ? AND redemptions_count < max_redemptions
    `).bind(code),
    env.ACCOUNT_DB.prepare(`
      UPDATE entitlements
      SET free_cloud_requests_limit = free_cloud_requests_limit + ?, updated_at = ?
      WHERE user_id = ?
    `).bind(promo.credits, now, userId),
  ]);

  return { account: await getAccountSnapshot(env, userId) };
}
