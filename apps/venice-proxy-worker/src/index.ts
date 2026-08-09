// Alice's blind Venice proxy.
//
// Its only jobs: hold the Venice API key server-side, refuse anything that is
// not an end-to-end encrypted request, and relay bytes.
//
// What it must never do, and what the code below is shaped to make impossible:
//   - decrypt anything (it has no client key, and never derives one)
//   - log prompts, responses, history, or any wallet data
//   - buffer the response (the upstream stream is passed straight through)
//   - serve as a plaintext relay (missing E2EE headers are rejected outright)

import {
  AccountHttpError,
  authenticate,
  cleanupExpiredAccountData,
  confirmFreeRequest,
  createAnonymousSession,
  getCurrentAccount,
  logout,
  loginWithPassword,
  recordCloudRequestMilestones,
  refreshSession,
  refundFreeRequest,
  requestAccountDeletion,
  requestId,
  revokeIdentity,
  reserveFreeRequest,
  startEmailLogin,
  startEmailIdentityLink,
  registerPasswordAccount,
  setAccountPassword,
  suggestUsernames,
  updateAccountProfile,
  verifyEmailLogin,
  verifyEmailIdentityLink,
} from './account.ts';
import {
  adminAdjustCredits,
  adminAnalytics,
  adminBootstrap,
  adminCreatePromoCode,
  adminDeleteAccount,
  adminDemote,
  adminDisablePromoCode,
  adminGetAccount,
  adminListAccessDenials,
  adminListAccounts,
  adminListAdmins,
  adminListAuditLog,
  adminListEvents,
  adminListPromoCodes,
  adminOverview,
  adminPromote,
  adminReactivateAccount,
  adminSession,
  adminSuspendAccount,
  recordProductEvents,
  recordTechnicalEvent,
  redeemPromoCode,
} from './admin.ts';
import { ADMIN_DASHBOARD_HTML } from './admin-dashboard-html.ts';
import {
  DEFAULT_FREE_REQUEST_BYTES,
  MAX_FREE_MESSAGES,
  MAX_TOKENS_CEILING,
} from './limits.ts';

export type Env = Omit<CloudflareEnv, 'AUTH_EMAIL_PROVIDER' | 'EMAIL'> & {
  /** Wrangler secret. Never an EXPO_PUBLIC_* value. */
  VENICE_API_KEY: string;
  /** Wrangler secret used only for irreversible account lookups and token hashes. */
  AUTH_HMAC_KEY: string;
  /** Optional Wrangler secret when AUTH_EMAIL_PROVIDER=resend. */
  RESEND_API_KEY?: string;
  /**
   * Wrangler secret, set once. Lets the first authenticated Alice account
   * promote itself to admin via POST /admin/api/bootstrap. Generate with:
   *   openssl rand -base64 48 | npx wrangler secret put ADMIN_BOOTSTRAP_SECRET
   * Rotating or removing it after bootstrap is recommended.
   */
  ADMIN_BOOTSTRAP_SECRET?: string;
  /**
   * Optional comma-separated username allowlist. When set, a session must
   * match one of these usernames AND have a row in `admin_users` to reach
   * the dashboard. Defence in depth against a rogue promotion or a direct
   * write to D1. Leave unset to let the database decide alone.
   */
  ADMIN_ALLOWED_USERNAMES?: string;
  /**
   * Optional secret path for the dashboard, e.g. "/console-7fq2xk". When set,
   * the shell and its API move there and "/admin" stops existing entirely.
   *
   * This is NOT a security control — obscurity keeps drive-by scanners and
   * bots away, nothing more. The password, the admin_users row and
   * ADMIN_ALLOWED_USERNAMES are what actually stop an attacker. Set it as a
   * Wrangler secret rather than a [vars] entry so it does not sit in git.
   */
  ADMIN_DASHBOARD_PATH?: string;
  /**
   * Master switch for the admin console. Unless this is exactly "true", the
   * dashboard and its entire API do not exist: every admin path 404s like any
   * unknown URL.
   *
   * Production leaves it unset, so the console is not merely hidden behind a
   * secret path — it is absent, and there is nothing to find or brute-force.
   * Local development sets it in .dev.vars (git-ignored), which is where the
   * console actually runs. Flipping it on in production later re-enables the
   * hosted console with no code change.
   */
  ADMIN_CONSOLE_ENABLED?: string;
  AUTH_EMAIL_PROVIDER?: string;
  EMAIL?: SendEmail;
  VENICE_API_BASE?: string;
  /** Fixed upstream PCCS for the DCAP collateral relay. Never client-chosen. */
  PCCS_UPSTREAM?: string;
};

const DEFAULT_VENICE_BASE = 'https://api.venice.ai/api/v1';
const DEFAULT_PCCS_UPSTREAM = 'https://pccs.phala.network';

/**
 * DCAP collateral is public certificate data (PCK CRL, TCB info, QE identity) —
 * never a prompt or a key. Relaying it through the Worker keeps the user's IP
 * off Phala/Intel. The client still verifies the quote locally; the Worker only
 * fetches these public files from a FIXED upstream and can never be pointed
 * elsewhere. Only these path segments are allowed.
 */
const PCCS_ALLOWED_PATH = /^\/pccs\/[a-z0-9/_.-]+$/i;

/** Response headers the dcap library needs from PCCS; must survive CORS. */
const PCCS_EXPOSED_HEADERS = [
  'SGX-TCB-Info-Issuer-Chain',
  'TCB-Info-Issuer-Chain',
  'SGX-PCK-CRL-Issuer-Chain',
  'SGX-Enclave-Identity-Issuer-Chain',
  'SGX-QE-Identity-Issuer-Chain',
];


/** Venice's E2EE headers. All three must be present for a chat request. */
const REQUIRED_E2EE_HEADERS = [
  'x-venice-tee-client-pub-key',
  'x-venice-tee-model-pub-key',
  'x-venice-tee-signing-algo',
] as const;

const FORWARDED_REQUEST_HEADERS = [...REQUIRED_E2EE_HEADERS, 'content-type'];
const ALICE_REQUEST_HEADERS = [
  'authorization',
  'x-alice-install-id',
  'x-alice-request-id',
  'x-alice-platform',
  'x-alice-app-version',
];
const EXPOSED_RESPONSE_HEADERS = [
  'x-alice-cloud-requests-remaining',
  'x-alice-request-id',
];

export function parseAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
}

export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = parseAllowedOrigins(env);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      ...FORWARDED_REQUEST_HEADERS,
      ...ALICE_REQUEST_HEADERS,
    ].join(', '),
    'Access-Control-Expose-Headers': EXPOSED_RESPONSE_HEADERS.join(', '),
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

/**
 * Clamp the generation budget. Reads only `max_tokens` and `stream` — the
 * message contents are ciphertext and are re-serialized untouched.
 */
export function sanitizeChatBody(raw: string): { body: string; model: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Body is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Body is not an object.');

  // E2EE is streaming-only upstream; refuse rather than silently rewrite, so a
  // client bug surfaces instead of turning into a non-encrypted round trip.
  if (parsed.stream !== true) throw new Error('E2EE requires streaming.');
  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
    throw new Error('At least one encrypted message is required.');
  }
  if (parsed.messages.length > MAX_FREE_MESSAGES) {
    throw new Error(`At most ${MAX_FREE_MESSAGES} encrypted messages are allowed.`);
  }
  for (const message of parsed.messages) {
    if (
      !message
      || typeof message !== 'object'
      || typeof message.role !== 'string'
      || typeof message.content !== 'string'
    ) {
      throw new Error('Every encrypted message must have a role and string content.');
    }
  }
  for (const capability of ['tools', 'tool_choice', 'functions', 'attachments']) {
    if (capability in parsed) {
      throw new Error(`${capability} is not available in the free plan.`);
    }
  }

  const requested = Number.isFinite(parsed.max_tokens)
    ? Math.floor(parsed.max_tokens)
    : MAX_TOKENS_CEILING;
  parsed.max_tokens = Math.max(1, Math.min(requested, MAX_TOKENS_CEILING));
  // E2EE is selected by the three required TEE headers. Do not forward Venice
  // capability switches from an untrusted client through the free relay.
  delete parsed.venice_parameters;

  return {
    body: JSON.stringify(parsed),
    model: typeof parsed.model === 'string' ? parsed.model : 'unknown',
  };
}

function freeMaxTokens(env: Env): number {
  const configured = Number(env.FREE_CLOUD_MAX_TOKENS ?? '2048');
  if (!Number.isSafeInteger(configured) || configured < 1) return 2048;
  return Math.min(configured, MAX_TOKENS_CEILING);
}

function freeMaxRequestBytes(env: Env): number {
  const configured = Number(env.FREE_CLOUD_MAX_REQUEST_BYTES ?? DEFAULT_FREE_REQUEST_BYTES);
  if (!Number.isSafeInteger(configured) || configured < 32 * 1024) {
    return DEFAULT_FREE_REQUEST_BYTES;
  }
  return Math.min(configured, 1024 * 1024);
}

function freeCloudModels(env: Env): Set<string> {
  return new Set(
    (env.FREE_CLOUD_MODELS ?? 'e2ee-gpt-oss-120b-p')
      .split(',')
      .map(model => model.trim())
      .filter(Boolean),
  );
}

export function missingE2EEHeaders(request: Request): string[] {
  return REQUIRED_E2EE_HEADERS.filter(h => !request.headers.get(h));
}

/**
 * Technical telemetry only. Deliberately takes primitives, never the body or
 * the headers, so there is no path by which content could be logged.
 */
function logTechnical(fields: { route: string; status: number; durationMs: number; model: string; approxBytes: number }): void {
  console.log(JSON.stringify({ ...fields, at: new Date().toISOString() }));
}

async function relayAttestation(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const started = Date.now();
  const incoming = new URL(request.url);
  const base = env.VENICE_API_BASE ?? DEFAULT_VENICE_BASE;
  const target = new URL(`${base.replace(/\/+$/, '')}/tee/attestation`);
  // Only the two parameters the endpoint takes; nothing else is forwarded.
  const model = incoming.searchParams.get('model') ?? '';
  const nonce = incoming.searchParams.get('nonce') ?? '';
  if (!model || !nonce) {
    return json({ error: 'model and nonce are required' }, 400, cors);
  }
  if (!/^[0-9a-f]{64}$/i.test(nonce)) {
    return json({
      error: {
        code: 'invalid_attestation_nonce',
        message: 'nonce must be exactly 32 bytes encoded as 64 hexadecimal characters',
      },
    }, 400, cors);
  }
  target.searchParams.set('model', model);
  target.searchParams.set('nonce', nonce);

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${env.VENICE_API_KEY}` },
  });

  logTechnical({
    route: 'attestation',
    status: upstream.status,
    durationMs: Date.now() - started,
    model,
    approxBytes: 0,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

async function relayChat(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  ctx?: ExecutionContext,
): Promise<Response> {
  const started = Date.now();
  const user = await authenticate(request, env);
  const idempotencyKey = requestId(request);

  // The guarantee that this proxy can never be a plaintext relay.
  const missing = missingE2EEHeaders(request);
  if (missing.length > 0) {
    return json({ error: `Missing E2EE headers: ${missing.join(', ')}` }, 400, cors);
  }

  const maxRequestBytes = freeMaxRequestBytes(env);
  const declaredBytes = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredBytes) && declaredBytes > maxRequestBytes) {
    throw new AccountHttpError(
      413,
      'body_too_large',
      'This Private Cloud request is too large.',
    );
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxRequestBytes) {
    throw new AccountHttpError(
      413,
      'body_too_large',
      'This Private Cloud request is too large.',
    );
  }
  let sanitized: { body: string; model: string };
  try {
    sanitized = sanitizeChatBody(raw);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Invalid body' }, 400, cors);
  }

  if (!freeCloudModels(env).has(sanitized.model)) {
    throw new AccountHttpError(
      403,
      'model_not_in_free_plan',
      'This model is not included in the free Alice account.',
    );
  }

  const parsed = JSON.parse(sanitized.body) as Record<string, unknown>;
  parsed.max_tokens = Math.min(
    typeof parsed.max_tokens === 'number' ? parsed.max_tokens : freeMaxTokens(env),
    freeMaxTokens(env),
  );
  sanitized.body = JSON.stringify(parsed);

  const reservation = await reserveFreeRequest(env, user.userId, idempotencyKey);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.VENICE_API_KEY}`,
    'Content-Type': 'application/json',
  };
  for (const name of REQUIRED_E2EE_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const base = env.VENICE_API_BASE ?? DEFAULT_VENICE_BASE;
  let upstream: Response;
  try {
    upstream = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: sanitized.body,
    });
  } catch (error) {
    await refundFreeRequest(env, reservation.ledgerId, 'upstream_network_error');
    throw error;
  }

  if (!upstream.ok) {
    await refundFreeRequest(env, reservation.ledgerId, `upstream_http_${upstream.status}`);
    await recordTechnicalEvent(env, 'venice', `upstream_http_${upstream.status}`, upstream.status, user.userId)
      .catch(() => {});
  } else {
    await confirmFreeRequest(env, reservation.ledgerId);
    const milestoneWrite = recordCloudRequestMilestones(
      request,
      env,
      reservation.used,
      reservation.limit,
    ).catch(() => {});
    if (ctx) ctx.waitUntil(milestoneWrite);
    else await milestoneWrite;
  }

  logTechnical({
    route: 'chat',
    status: upstream.status,
    durationMs: Date.now() - started,
    model: sanitized.model,
    approxBytes: sanitized.body.length,
  });

  // Pass the stream straight through: no buffering, no inspection.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Alice-Cloud-Requests-Remaining': String(
        upstream.ok ? reservation.remaining : reservation.remaining + 1,
      ),
      'X-Alice-Request-Id': idempotencyKey,
      ...cors,
    },
  });
}

async function accountRoute(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/auth/anonymous' && request.method === 'POST') {
    return json(await createAnonymousSession(request, env), 200, cors);
  }
  if (url.pathname === '/auth/email/start' && request.method === 'POST') {
    return json(await startEmailLogin(request, env), 200, cors);
  }
  if (url.pathname === '/auth/email/verify' && request.method === 'POST') {
    return json(await verifyEmailLogin(request, env), 200, cors);
  }
  if (url.pathname === '/auth/username/suggestions' && request.method === 'POST') {
    return json(await suggestUsernames(request, env), 200, cors);
  }
  if (url.pathname === '/auth/password/register' && request.method === 'POST') {
    return json(await registerPasswordAccount(request, env), 200, cors);
  }
  if (url.pathname === '/auth/password/login' && request.method === 'POST') {
    return json(await loginWithPassword(request, env), 200, cors);
  }
  if (url.pathname === '/auth/refresh' && request.method === 'POST') {
    return json(await refreshSession(request, env), 200, cors);
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    await logout(request, env);
    return new Response(null, { status: 204, headers: cors });
  }
  if (url.pathname === '/account' && request.method === 'GET') {
    return json(await getCurrentAccount(request, env), 200, cors);
  }
  if (url.pathname === '/account/identities/email/start' && request.method === 'POST') {
    return json(await startEmailIdentityLink(request, env), 200, cors);
  }
  if (url.pathname === '/account/identities/email/verify' && request.method === 'POST') {
    return json(await verifyEmailIdentityLink(request, env), 200, cors);
  }
  if (url.pathname === '/account/password' && request.method === 'PUT') {
    return json(await setAccountPassword(request, env), 200, cors);
  }
  if (url.pathname === '/account/profile' && request.method === 'PUT') {
    return json(await updateAccountProfile(request, env), 200, cors);
  }
  if (url.pathname === '/account/identities/revoke' && request.method === 'POST') {
    return json(await revokeIdentity(request, env), 200, cors);
  }
  if (url.pathname === '/account/deletion-request' && request.method === 'POST') {
    await requestAccountDeletion(request, env);
    return new Response(null, { status: 204, headers: cors });
  }
  if (url.pathname === '/account/promo/redeem' && request.method === 'POST') {
    return json(await redeemPromoCode(request, env), 200, cors);
  }
  if (url.pathname === '/account/events' && request.method === 'POST') {
    return json(await recordProductEvents(request, env), 200, cors);
  }
  return null;
}

/**
 * Where the dashboard lives. Defaults to /admin. A malformed value falls
 * back to the default rather than half-applying: a typo must not silently
 * leave the dashboard reachable at two places, or at none.
 */
/** The console exists only where it has been explicitly switched on. */
export function adminConsoleEnabled(env: Env): boolean {
  return env.ADMIN_CONSOLE_ENABLED?.trim() === 'true';
}

export function adminBasePath(env: Env): string {
  const raw = env.ADMIN_DASHBOARD_PATH?.trim() ?? '';
  if (!raw) return '/admin';
  return /^\/[a-zA-Z0-9._~-]{1,64}$/.test(raw) ? raw : '/admin';
}

async function adminRoute(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  basePath: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.slice(`${basePath}/api`.length) || '/';
  const segments = path.split('/').filter(Boolean);

  if (path === '/bootstrap' && request.method === 'POST') {
    return json(await adminBootstrap(request, env), 200, cors);
  }
  if (path === '/session' && request.method === 'GET') {
    return json(await adminSession(request, env), 200, cors);
  }
  if (path === '/overview' && request.method === 'GET') {
    return json(await adminOverview(request, env), 200, cors);
  }
  if (path === '/analytics' && request.method === 'GET') {
    return json(await adminAnalytics(request, env), 200, cors);
  }
  if (path === '/events' && request.method === 'GET') {
    return json(await adminListEvents(request, env), 200, cors);
  }
  if (path === '/access-denials' && request.method === 'GET') {
    return json(await adminListAccessDenials(request, env), 200, cors);
  }
  if (path === '/accounts' && request.method === 'GET') {
    return json(await adminListAccounts(request, env), 200, cors);
  }
  if (segments[0] === 'accounts' && segments.length === 2 && request.method === 'GET') {
    return json(await adminGetAccount(request, env, decodeURIComponent(segments[1])), 200, cors);
  }
  if (segments[0] === 'accounts' && segments[2] === 'suspend' && request.method === 'POST') {
    return json(await adminSuspendAccount(request, env, decodeURIComponent(segments[1])), 200, cors);
  }
  if (segments[0] === 'accounts' && segments[2] === 'reactivate' && request.method === 'POST') {
    return json(await adminReactivateAccount(request, env, decodeURIComponent(segments[1])), 200, cors);
  }
  if (segments[0] === 'accounts' && segments[2] === 'credits' && request.method === 'POST') {
    return json(await adminAdjustCredits(request, env, decodeURIComponent(segments[1])), 200, cors);
  }
  if (segments[0] === 'accounts' && segments.length === 2 && request.method === 'DELETE') {
    return json(await adminDeleteAccount(request, env, decodeURIComponent(segments[1])), 200, cors);
  }
  if (path === '/admins' && request.method === 'GET') {
    return json(await adminListAdmins(request, env), 200, cors);
  }
  if (path === '/admins' && request.method === 'POST') {
    return json(await adminPromote(request, env), 200, cors);
  }
  if (segments[0] === 'admins' && segments.length === 2 && request.method === 'DELETE') {
    return json(await adminDemote(request, env, decodeURIComponent(segments[1])), 200, cors);
  }
  if (path === '/audit-log' && request.method === 'GET') {
    return json(await adminListAuditLog(request, env), 200, cors);
  }
  if (path === '/promo-codes' && request.method === 'GET') {
    return json(await adminListPromoCodes(request, env), 200, cors);
  }
  if (path === '/promo-codes' && request.method === 'POST') {
    return json(await adminCreatePromoCode(request, env), 200, cors);
  }
  if (segments[0] === 'promo-codes' && segments[2] === 'disable' && request.method === 'POST') {
    return json(await adminDisablePromoCode(request, env, decodeURIComponent(segments[1])), 200, cors);
  }
  return null;
}

/** Codes that mean "an email failed to send", not "the caller made a mistake". */
const EMAIL_ERROR_CODES = new Set(['email_not_configured', 'email_delivery_failed']);

function classifyErrorCategory(error: AccountHttpError, route: string): 'auth' | 'email' | 'venice' | null {
  if (route === 'venice') return 'venice';
  if (EMAIL_ERROR_CODES.has(error.code)) return 'email';
  if (route === 'auth' || route === 'admin') return 'auth';
  return null;
}

function accountErrorResponse(
  error: unknown,
  cors: Record<string, string>,
  env: Env,
  route: 'auth' | 'venice' | 'admin' = 'auth',
): Response {
  if (error instanceof AccountHttpError) {
    const category = classifyErrorCategory(error, route);
    if (category) {
      recordTechnicalEvent(env, category, error.code, error.status).catch(() => {});
    }
    return json({ error: { code: error.code, message: error.message } }, error.status, cors);
  }
  console.error(JSON.stringify({
    route: 'account',
    status: 500,
    error: error instanceof Error ? error.name : 'unknown',
    at: new Date().toISOString(),
  }));
  recordTechnicalEvent(env, route === 'venice' ? 'venice' : 'auth', 'internal_error', 500).catch(() => {});
  return json(
    { error: { code: 'internal_error', message: 'Alice could not complete this request.' } },
    500,
    cors,
  );
}

/**
 * Locked-down PCCS collateral relay. GET only, path-allowlisted, forwarded to a
 * fixed upstream — the client cannot choose the destination, so this can never
 * become an open proxy. No request body, no body logging, no key attached
 * (collateral is public). Response is cacheable and issuer-chain headers are
 * exposed for CORS so the client library can read them.
 */
export async function relayPccs(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  if (!PCCS_ALLOWED_PATH.test(url.pathname) || url.pathname.includes('..') || url.pathname.includes('://')) {
    return json({ error: 'Not found' }, 404, cors);
  }
  const upstream = (env.PCCS_UPSTREAM ?? DEFAULT_PCCS_UPSTREAM).replace(/\/+$/, '');
  const rest = url.pathname.slice('/pccs/'.length);
  const target = `${upstream}/${rest}${url.search}`;

  const resp = await fetch(target, { method: 'GET' });

  const headers: Record<string, string> = {
    'Content-Type': resp.headers.get('content-type') ?? 'application/octet-stream',
    'Cache-Control': 'public, max-age=3600',
    ...cors,
    'Access-Control-Expose-Headers': [
      ...PCCS_EXPOSED_HEADERS,
      ...EXPOSED_RESPONSE_HEADERS,
    ].join(', '),
  };
  for (const h of PCCS_EXPOSED_HEADERS) {
    const v = resp.headers.get(h);
    if (v) headers[h] = v;
  }

  logTechnical({ route: 'pccs', status: resp.status, durationMs: Date.now() - started, model: rest.split('/')[0] ?? '', approxBytes: 0 });
  return new Response(resp.body, { status: resp.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get('Origin'), env);

    if (request.method === 'OPTIONS') {
      // Admin routes are same-origin only and never answer a preflight, so a
      // cross-origin script cannot reach them even from an allowlisted app.
      if (adminConsoleEnabled(env) && url.pathname.startsWith(adminBasePath(env))) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    // Collateral relay needs no Venice key (public data), so it is reachable
    // even before the key check below.
    if (url.pathname.startsWith('/pccs/') && request.method === 'GET') {
      return relayPccs(request, env, cors);
    }

    if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/account')) {
      if (!env.ACCOUNT_DB || !env.AUTH_HMAC_KEY) {
        return json(
          { error: { code: 'account_not_configured', message: 'Alice accounts are not configured.' } },
          500,
          cors,
        );
      }
      try {
        const response = await accountRoute(request, env, cors);
        if (response) return response;
      } catch (error) {
        return accountErrorResponse(error, cors, env, 'auth');
      }
    }

    // Admin dashboard: a static shell at /admin (no data, just the page) and
    // its JSON API under /admin/api/* (every route requires an admin
    // session — see admin.ts). Deliberately not under /auth or /account so
    // it never gets swept into the public-route contract above.
    const adminBase = adminBasePath(env);
    const adminEnabled = adminConsoleEnabled(env);
    if (adminEnabled && url.pathname === adminBase && request.method === 'GET') {
      return new Response(ADMIN_DASHBOARD_HTML, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          // The dashboard has one-click destructive controls, so it must
          // never be framable: without this, a hostile page could overlay
          // an invisible iframe and trick an admin into clicking Delete.
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': [
            "default-src 'none'",
            "script-src 'unsafe-inline'",
            "style-src 'unsafe-inline'",
            // The two brand fonts are embedded as data: URIs (no CDN); with
            // no font-src, 'default-src none' blocked them outright and the
            // page rendered with the fallback OS font instead of Alice's.
            "font-src data:",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "form-action 'none'",
            "base-uri 'none'",
          ].join('; '),
          // Never leak the admin URL to anything the browser navigates to.
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      });
    }
    if (adminEnabled && url.pathname.startsWith(`${adminBase}/api/`)) {
      if (!env.ACCOUNT_DB || !env.AUTH_HMAC_KEY) {
        return json(
          { error: { code: 'account_not_configured', message: 'Alice accounts are not configured.' } },
          500,
          cors,
        );
      }
      // Deliberately NO CORS headers on the admin API. The dashboard is
      // served same-origin by this Worker, so it needs none — and withholding
      // them means no other allowlisted Alice origin (the wallet apps,
      // localhost during development) can script a request against these
      // endpoints from a user's browser.
      try {
        const response = await adminRoute(request, env, {}, adminBase);
        if (response) return response;
      } catch (error) {
        return accountErrorResponse(error, {}, env, 'admin');
      }
    }

    if (!env.VENICE_API_KEY) {
      return json({ error: 'Proxy is not configured.' }, 500, cors);
    }

    if (url.pathname === '/api/v1/tee/attestation' && request.method === 'GET') {
      try {
        await authenticate(request, env);
        return relayAttestation(request, env, cors);
      } catch (error) {
        return accountErrorResponse(error, cors, env, 'venice');
      }
    }
    if (url.pathname === '/api/v1/chat/completions' && request.method === 'POST') {
      try {
        return await relayChat(request, env, cors, ctx);
      } catch (error) {
        return accountErrorResponse(error, cors, env, 'venice');
      }
    }
    return json({ error: 'Not found' }, 404, cors);
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(cleanupExpiredAccountData(env));
  },
};
