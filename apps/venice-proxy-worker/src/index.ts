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

import { APP_RELEASE_VERSION } from './app-release.ts';
import { checkAndAlert, handleTunnelAlert } from './ops-alert.ts';
import {
  AccountHttpError,
  authenticate,
  cleanupExpiredAccountData,
  confirmFreeRequest,
  createAnonymousSession,
  getCurrentAccount,
  hmac,
  logout,
  loginWithPassword,
  recordCloudRequestMilestones,
  refreshSession,
  rateLimit,
  refundFreeRequest,
  requestAccountDeletion,
  requestId,
  revokeIdentity,
  reserveFreeRequest,
  startEmailLogin,
  startEmailIdentityLink,
  setAccountPassword,
  suggestUsernames,
  updateAccountProfile,
  verifyEmailLogin,
  verifyEmailIdentityLink,
  updateEmailPreferences,
  usernameVocabulary,
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
  adminTestWalletFaucet,
  recordProductEvents,
  recordTechnicalEvent,
  redeemPromoCode,
} from './admin.ts';
import {
  cleanupBillingData,
  getPlanQuotes,
  recordMeasuredBytes,
  countingStream,
  createCheckout,
  getCurrentBilling,
  handleBtcpayWebhook,
  refundCloudBytes,
  reserveCloudBytes,
  resolvePlan,
  sendExpiryReminders,
  settleCloudBytes,
  bytesPerToken,
  type Plan,
} from './billing.ts';
import { refreshSatPrice } from './sat-price.ts';
import { ADMIN_DASHBOARD_HTML } from './admin-dashboard-html.ts';
import { lookupEntities } from './entities.ts';
import { claimTestWalletFaucet } from './test-wallet-faucet.ts';
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
   * Optional Wrangler secret: the 12 words of the Mutinynet wallet Alice
   * dispenses test sats from. Mutinynet coins have no value, so this key
   * guards nothing of worth, but it is still a secret rather than a var so
   * it never sits in git. Unset simply turns the faucet off.
   *   npx wrangler secret put TEST_WALLET_FAUCET_MNEMONIC
   */
  TEST_WALLET_FAUCET_MNEMONIC?: string;
  /** Watch-only account key: lets the console read the float, never spend it. */
  TEST_WALLET_FAUCET_XPUB?: string;
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

  // --- Billing -------------------------------------------------------------
  // Payment is Bitcoin only, through BTCPay. Leaving BTCPAY_* unset makes
  // checkout return 503 and changes nothing else, which is the state the
  // Worker ships in until the store is live.
  /** e.g. https://btcpay.example.com */
  BTCPAY_BASE_URL?: string;
  BTCPAY_STORE_ID?: string;
  /** Wrangler secret: npx wrangler secret put BTCPAY_API_KEY */
  BTCPAY_API_KEY?: string;
  /** Wrangler secret. Without it the webhook route does not exist at all. */
  BTCPAY_WEBHOOK_SECRET?: string;
  /** Where BTCPay sends the buyer back once the invoice is settled. */
  BILLING_RETURN_URL?: string;

  /**
   * Where to warn a human when payments cannot be taken (src/ops-alert.ts).
   * Use an address you actually watch, not the public contact one: a technical
   * alert buried under user mail is an alert nobody reads. Both channels are
   * optional and independent, so one being unset never silences the other.
   *   npx wrangler secret put OPS_ALERT_EMAIL
   */
  OPS_ALERT_EMAIL?: string;
  /** Telegram bot token from @BotFather: the channel that actually buzzes. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Chat to write to. Ask @userinfobot for your own id. */
  TELEGRAM_CHAT_ID?: string;
  /**
   * Shared secret in the alert URL. Notification webhooks generally cannot
   * send custom headers, so the secret travels in the path. Unset means the
   * route answers 404 rather than standing open.
   *   openssl rand -hex 32 | npx wrangler secret put OPS_ALERT_SECRET
   */
  OPS_ALERT_SECRET?: string;
  /**
   * Wrangler secret. Encrypts the optional renewal-reminder address at rest:
   *   openssl rand -base64 48 | npx wrangler secret put BILLING_EMAIL_KEY
   * Unset means no reminder emails are stored or sent, and the rest of billing
   * still works. Rotating it makes stored addresses undecryptable, so the
   * reminders stop rather than going to the wrong person.
   */
  BILLING_EMAIL_KEY?: string;

  /**
   * Encrypts the address every account carries. Alice opens it only to send:
   * an expiring plan, and the product mail people opt into. See
   * email-vault.ts for what that protects and what it does not.
   */
  ACCOUNT_EMAIL_KEY?: string;
  /** Plan prices in cents. Defaults: 500 and 1000. */
  PLAN_CLOUD_PRICE_CENTS?: string;
  /** Monthly allowance as advertised, in tokens. Defaults: 8M in, 2M out. */
  PLAN_INPUT_TOKENS?: string;
  PLAN_OUTPUT_TOKENS?: string;
  /** Deep Research runs included with Cloud+ each month. Default: 21. */
  /**
   * Bytes per token, the calibration constant that converts the advertised
   * token allowance into the byte budget actually enforced.
   *
   * The proxy relays end-to-end encrypted traffic and never buffers it, so it
   * cannot read Venice's token counts; it counts bytes instead. Compare the
   * Worker's monthly byte total with Venice's invoice and adjust this. Default
   * 3.7, which suits French and English prose.
   */
  BYTES_PER_TOKEN?: string;

  /**
   * Prices are quoted in satoshis. These two govern the quote: the currency
   * the plans are anchored to, and the rounding step the quote lands on.
   */
  BILLING_CURRENCY?: string;
  SAT_PRICE_STEP?: string;
};

/** Backstop on the money route. Generous for a person, narrow for a script. */
const CHAT_REQUESTS_PER_HOUR = 240;

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
  'x-alice-plan',
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
    // Every method a browser route actually uses. PUT and DELETE were missing
    // for as long as no browser called them; the day the account screens
    // shipped, setting a password or saving a username died in preflight, as
    // a "network error" with nothing in the server logs, because the blocked
    // request is never sent at all.
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
  // capability switches from an untrusted client through the free relay: web
  // search and scraping bill per request, so a browser that could set them
  // could spend Alice's balance at will.
  //
  // Alice tried setting enable_web_search here herself, for Deep Research
  // runs. It was delivered to Venice, byte for byte, and changed nothing: the
  // search subsystem has to read the question to search for it, and under E2EE
  // the question is ciphertext addressed to the enclave. The switch is
  // accepted and ignored. Search and end-to-end encryption exclude each other,
  // and not only at Venice: searching the web means telling someone what you
  // are looking for. See docs/billing-and-quotas.md.
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

function modelList(value: string | undefined, fallback: string): Set<string> {
  return new Set(
    (value ?? fallback)
      .split(',')
      .map(model => model.trim())
      .filter(Boolean),
  );
}

function freeCloudModels(env: Env): Set<string> {
  return modelList(env.FREE_CLOUD_MODELS, 'e2ee-gpt-oss-120b-p');
}

/**
 * Which models a plan may reach.
 *
 * Deep Research is the one model gated by plan rather than by allowance, so
 * this is the only place that decides it. A Cloud subscriber asking for it is
 * refused with a code that says the plan does not include it, which is a
 * different sentence from having run out, and leads somewhere different.
 */
export function modelsForPlan(env: Env, plan: Plan): Set<string> {
  if (plan === 'free') return freeCloudModels(env);
  return modelList(env.PAID_CLOUD_MODELS, [...freeCloudModels(env)].join(','));
}

/**
 * The answer-length ceiling. A paid plan is metered by volume, so capping it at
 * the free plan's short answers would sell capacity that cannot be spent.
 */
function paidMaxTokens(env: Env): number {
  const configured = Number(env.PAID_CLOUD_MAX_TOKENS ?? 8192);
  if (!Number.isSafeInteger(configured) || configured < 1) return 8192;
  return Math.min(configured, MAX_TOKENS_CEILING);
}

/**
 * How large a single request may be.
 *
 * Tokens cannot be counted here: the payload is encrypted. Bytes are, so a
 * limit stated in tokens anywhere else is converted with the same calibration
 * ratio the whole meter uses. A wrong ratio therefore moves this limit as
 * well, in the same direction, which is one more reason to calibrate it
 * against a real invoice.
 */
export function maxRequestBytes(env: Env, plan: Plan): number {
  if (plan === 'free') return freeMaxRequestBytes(env);
  const configured = Number(env.PAID_CLOUD_MAX_REQUEST_BYTES ?? 512 * 1024);
  if (!Number.isSafeInteger(configured) || configured < 32 * 1024) return 512 * 1024;
  return configured;
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

  // A ceiling on the one route that spends money.
  //
  // Every other budget here is a product rule: twenty-one free requests, a
  // month of bytes. Those bound what a person may have, not how fast a script
  // may ask, and they were the only thing standing between a valid session and
  // Alice's Venice balance. This is the backstop underneath them: a person
  // types, and 240 requests an hour is far more than typing.
  //
  // Keyed on the account rather than the IP on purpose. Alice is used over Tor
  // and shared exits, where an address is a crowd, and throttling the crowd to
  // protect a balance would charge the wrong people for it. Anonymous accounts
  // are already capped per IP where they are created.
  await rateLimit(
    env,
    await hmac(env, `cloud-chat:${user.userId}`),
    'cloud_chat',
    CHAT_REQUESTS_PER_HOUR,
    Date.now(),
  );

  // The plan decides what may be asked for, so it is resolved before anything
  // is read or judged.
  const plan = await resolvePlan(env, user.userId);

  // Checked twice against the same limit, on purpose. The declared length is
  // refused first so an oversized payload is never buffered; the real length
  // is refused after, because a Content-Length header is a claim and not a
  // measurement.
  const ceilingBytes = maxRequestBytes(env, plan);
  const declaredBytes = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredBytes) && declaredBytes > ceilingBytes) {
    throw new AccountHttpError(
      413,
      'body_too_large',
      'This Private Cloud request is too large.',
    );
  }
  const raw = await request.text();
  const rawBytes = new TextEncoder().encode(raw).byteLength;
  if (rawBytes > ceilingBytes) {
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

  if (!modelsForPlan(env, plan).has(sanitized.model)) {
    throw new AccountHttpError(
      403,
      'model_not_in_plan',
      'This model is not included in your Alice plan.',
    );
  }

  // Now the model is known, so the real size limit applies.
  if (rawBytes > maxRequestBytes(env, plan)) {
    throw new AccountHttpError(
      413,
      'body_too_large',
      'This Private Cloud request is too large.',
    );
  }

  const parsed = JSON.parse(sanitized.body) as Record<string, unknown>;
  const maxTokens = plan === 'free' ? freeMaxTokens(env) : paidMaxTokens(env);
  parsed.max_tokens = Math.min(
    typeof parsed.max_tokens === 'number' ? parsed.max_tokens : maxTokens,
    maxTokens,
  );
  sanitized.body = JSON.stringify(parsed);

  // Free accounts are metered in requests, paid ones in bytes. The two ledgers
  // share a table but never a row: a request is charged to exactly one of them.
  const inputBytes = new TextEncoder().encode(sanitized.body).byteLength;
  const freeReservation = plan === 'free'
    ? await reserveFreeRequest(env, user.userId, idempotencyKey)
    : null;
  const byteReservation = plan === 'free'
    ? null
    : await reserveCloudBytes(
      env,
      user.userId,
      idempotencyKey,
      inputBytes,
      parsed.max_tokens as number,
    );

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
    if (freeReservation) {
      await refundFreeRequest(env, freeReservation.ledgerId, 'upstream_network_error');
    }
    if (byteReservation) {
      await refundCloudBytes(env, byteReservation, 'upstream_network_error');
    }
    throw error;
  }

  if (!upstream.ok) {
    const failure = `upstream_http_${upstream.status}`;
    if (freeReservation) await refundFreeRequest(env, freeReservation.ledgerId, failure);
    if (byteReservation) await refundCloudBytes(env, byteReservation, failure);
    await recordTechnicalEvent(env, 'venice', failure, upstream.status, user.userId)
      .catch(() => {});
  } else if (freeReservation) {
    await confirmFreeRequest(env, freeReservation.ledgerId);
    const milestoneWrite = recordCloudRequestMilestones(
      request,
      env,
      freeReservation.used,
      freeReservation.limit,
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

  // A paid request is charged for what it actually returns, and the size of a
  // response is only known once it has all gone past. The counter sits in the
  // stream and adds up byte lengths; it never reads, copies or holds a chunk,
  // so the response still reaches the user unbuffered and still encrypted.
  let body = upstream.body;
  if (byteReservation && upstream.ok && body) {
    const counter = countingStream();
    body = body.pipeThrough(counter.stream);
    const settlement = counter.done
      .then(outputBytes => settleCloudBytes(env, byteReservation, outputBytes))
      .catch(() => {});
    if (ctx) ctx.waitUntil(settlement);
  } else if (freeReservation && upstream.ok && body) {
    // The same counter, moving no counter of its own. A free request is still
    // charged one request whatever it weighs; this only writes the weight down,
    // so the calibration ratio can be checked against Venice's token totals
    // without having to sell a plan first and verify the arithmetic later.
    const counter = countingStream();
    body = body.pipeThrough(counter.stream);
    const measurement = counter.done
      .then(outputBytes => recordMeasuredBytes(
        env,
        freeReservation.ledgerId,
        inputBytes,
        outputBytes,
      ))
      .catch(() => {});
    if (ctx) ctx.waitUntil(measurement);
  }

  // Pass the stream straight through: no buffering, no inspection.
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-store',
      ...(freeReservation
        ? {
          'X-Alice-Cloud-Requests-Remaining': String(
            upstream.ok ? freeReservation.remaining : freeReservation.remaining + 1,
          ),
        }
        : {}),
      'X-Alice-Plan': plan,
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
  if (url.pathname === '/auth/username/vocabulary' && request.method === 'GET') {
    return json(await usernameVocabulary(request, env), 200, cors);
  }
  if (url.pathname === '/auth/username/suggestions' && request.method === 'POST') {
    return json(await suggestUsernames(request, env), 200, cors);
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
  if (url.pathname === '/billing/plans' && request.method === 'GET') {
    // Public: a price list is of no use behind a login, and someone deciding
    // whether to buy has not signed in yet.
    return json(await getPlanQuotes(request, env), 200, cors);
  }
  if (url.pathname === '/billing' && request.method === 'GET') {
    return json(await getCurrentBilling(request, env), 200, cors);
  }
  if (url.pathname === '/billing/checkout' && request.method === 'POST') {
    return json(await createCheckout(request, env), 200, cors);
  }
  if (url.pathname === '/account/email/preferences' && request.method === 'PUT') {
    return json(await updateEmailPreferences(request, env), 200, cors);
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
  if (path === '/test-wallet-faucet' && request.method === 'GET') {
    return json(await adminTestWalletFaucet(request, env), 200, cors);
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

    // Explorer entity lookup: public, sourced attribution data for the giant
    // packs the client cannot bundle. No Venice key, no auth, no logged body.
    if (url.pathname === '/explorer/entities' && request.method === 'POST') {
      return json(await lookupEntities(request, env), 200, cors);
    }

    // BTCPay's callback. It carries no session and no CORS origin: it is
    // authenticated by the HMAC signature BTCPay puts on the body, and by
    // nothing else. Placed before the account block so it never inherits the
    // session handling that applies there.
    if (url.pathname === '/billing/webhook/btcpay' && request.method === 'POST') {
      if (!env.ACCOUNT_DB || !env.BTCPAY_WEBHOOK_SECRET) {
        return new Response('billing not configured', { status: 503 });
      }
      return handleBtcpayWebhook(request, env);
    }

    // An external uptime watcher calls this when its probe changes state. It
    // only knows the probe moved; Alice asks BTCPay herself before deciding it
    // is an outage, which is what keeps a restart from crying wolf. The secret
    // is in the path because notification webhooks carry no custom headers.
    if (url.pathname.startsWith('/ops/tunnel-alert/') && request.method === 'POST') {
      return handleTunnelAlert(request, env, url.pathname.slice('/ops/tunnel-alert/'.length));
    }

    // Latest released app version, public and unauthenticated. The four
    // surfaces version together and the Worker deploys with each release, so
    // this constant IS the release number; every surface polls it to offer
    // the update banner (packages/alice-ai/src/app-update.ts). Cacheable:
    // nothing here is per-user.
    if (url.pathname === '/app-version' && request.method === 'GET') {
      return json({ version: APP_RELEASE_VERSION }, 200, {
        ...cors,
        'Cache-Control': 'public, max-age=300',
      });
    }

    // Test wallet faucet: public and Venice-key-free, but it needs the
    // rate-limit store and the IP hashing key, so it is guarded on those.
    if (url.pathname === '/test-wallet/faucet' && request.method === 'POST') {
      if (!env.ACCOUNT_DB || !env.AUTH_HMAC_KEY) {
        return json(
          { error: { code: 'faucet_not_configured', message: 'The test wallet faucet is not configured.' } },
          500,
          cors,
        );
      }
      try {
        return json(await claimTestWalletFaucet(request, env), 200, cors);
      } catch (error) {
        return accountErrorResponse(error, cors, env, 'auth');
      }
    }

    if (
      url.pathname.startsWith('/auth/')
      || url.pathname.startsWith('/account')
      || url.pathname.startsWith('/billing')
    ) {
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
            // GitHub's public API is the one external call: the download
            // counters of the released APKs, read-only and unauthenticated.
            "connect-src 'self' https://api.github.com",
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
        const user = await authenticate(request, env);
        // Same ceiling as the chat route, separate bucket. This door does not
        // bill, but it goes upstream wearing Alice's key: a session hammering
        // it makes Venice's rate limiting the key's problem instead of the
        // session's. One attestation precedes each chat call, so a budget the
        // chat route can never exhaust costs honest traffic nothing.
        await rateLimit(
          env,
          await hmac(env, `attestation:${user.userId}`),
          'attestation',
          CHAT_REQUESTS_PER_HOUR * 2,
          Date.now(),
        );
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
    ctx.waitUntil(cleanupBillingData(env));
    // Bitcoin cannot direct-debit, so an expiring plan is a decision the user
    // has to make. These are the only two mails Alice sends unprompted, and
    // only to an address the account holder added for exactly this.
    ctx.waitUntil(sendExpiryReminders(env).then(() => {}).catch(() => {}));
    // The only place the satoshi price is allowed to move. Doing it here and
    // not in the request path is what keeps a quote from ticking while
    // somebody is reading it.
    ctx.waitUntil(refreshSatPrice(env).catch(() => {}));
    // The payment host is a separate service. Nothing else notices when it
    // stops answering: the app keeps working and only the checkout fails,
    // silently, on the one screen where money was about to move.
    ctx.waitUntil(checkAndAlert(env, 'cron').then(() => {}).catch(() => {}));
  },
};
