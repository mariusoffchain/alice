// Paid plans, Bitcoin invoices and byte-metered quotas.
//
// Three things shape every decision in this file.
//
// 1. Payment is Bitcoin only, through BTCPay. There is no card on file and no
//    direct debit, so a plan cannot renew itself. It expires, and the user
//    chooses to buy more. Everything here is built around that instead of
//    pretending otherwise.
//
// 2. The proxy relays end-to-end encrypted traffic and never buffers a
//    response, so it cannot read Venice's token counts. It counts the bytes
//    that pass through instead, without inspecting them. Bytes are the unit of
//    record; tokens are a presentation unit derived with a calibration ratio.
//
// 3. Alice cannot email a user out of the blue. Sign-in keeps only hmac(email)
//    and a masked label. A renewal reminder therefore needs an address the
//    user volunteers, kept encrypted, used for nothing else.

import type { Env } from './index.ts';
import { anchorCurrency, currentRateMinor, satsForMinor, satStep } from './sat-price.ts';
import { accountEmailMasked } from './account-email.ts';
import { decryptEmail, emailVaultConfigured } from './email-vault.ts';
import {
  AccountHttpError,
  authenticate,
  maskEmail,
  normalizeEmail,
  parseJsonBody,
  rateLimit,
  requestIpBucket,
  sendAccountEmail,
  uuid,
} from './account.ts';

/** Length of one paid period. Prepaying N months simply adds N of these. */
export const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;

/** Most months a single invoice may buy. Matches the CHECK on `invoices`. */
const MAX_PREPAID_MONTHS = 24;

/** How long a billing address outlives the plan it was added for. */
/** How long a sent-reminder marker is kept before it is swept away. */
const REMINDER_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const REMINDER_LEAD_MS = 3 * 24 * 60 * 60 * 1_000;

/**
 * Fallback bytes per token, used when BYTES_PER_TOKEN is unset.
 *
 * Roughly what French and English prose weigh once tokenised. It is a
 * calibration constant, not a law: compare the Worker's monthly byte total to
 * Venice's invoice and adjust the variable. Code, accented text and emoji all
 * push the true ratio around, which is why the account screen shows a
 * percentage and never a token count presented as exact.
 */
const DEFAULT_BYTES_PER_TOKEN = 3.7;

export type PaidPlan = 'cloud';
export type Plan = 'free' | PaidPlan;

export type PlanDefinition = {
  plan: PaidPlan;
  priceCents: number;
  inputBytesLimit: number;
  outputBytesLimit: number;
};

export type BillingSnapshot = {
  plan: Plan;
  /** What was bought, even if it has since lapsed. */
  purchased_plan: Plan;
  plan_expires_at: number | null;
  /** True once the expiry has passed and the account is back on free limits. */
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

type EntitlementRow = {
  plan: string;
  plan_expires_at: number | null;
  cloud_enabled: number;
  free_cloud_requests_limit: number;
  input_bytes_limit: number;
  output_bytes_limit: number;
};

type UsageRow = {
  input_bytes_used: number;
  output_bytes_used: number;
  period_started_at: number | null;
};

export type ByteReservation = {
  ledgerId: string;
  inputBytes: number;
  reservedOutputBytes: number;
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function bytesPerToken(env: Env): number {
  const parsed = Number(env.BYTES_PER_TOKEN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BYTES_PER_TOKEN;
}

/**
 * The commercial grid, entirely in config so a price change is a variable
 * change and never a code change. Token allowances are declared the way they
 * are advertised, then converted to the byte budgets actually enforced.
 */
export function planCatalog(env: Env): Record<PaidPlan, PlanDefinition> {
  const ratio = bytesPerToken(env);
  const inputTokens = positiveInt(env.PLAN_INPUT_TOKENS, 8_000_000);
  const outputTokens = positiveInt(env.PLAN_OUTPUT_TOKENS, 2_000_000);
  const inputBytesLimit = Math.floor(inputTokens * ratio);
  const outputBytesLimit = Math.floor(outputTokens * ratio);
  return {
    cloud: {
      plan: 'cloud',
      priceCents: positiveInt(env.PLAN_CLOUD_PRICE_CENTS, 500),
      inputBytesLimit,
      outputBytesLimit,
    },
  };
}

/**
 * The public price list, quoted in satoshis.
 *
 * Buyers never see the euro anchor. It exists so the plans keep paying for the
 * models underneath when the exchange rate moves, but what a buyer is asked
 * for, and what the invoice will say, is this satoshi figure.
 *
 * A missing rate returns a null satoshi quote rather than falling back to the
 * anchor: charging in the wrong unit would be worse than not charging, and
 * checkout has nothing to invoice while the rate is unknown.
 *
 * The anchor travels with the quote so the app can print it underneath as a
 * familiar landmark. It is a second reading of the same price, never a second
 * price: what is charged is the satoshi figure, and the two stop matching to
 * the cent as soon as rounding and the rate get involved, which is why the app
 * shows the anchor as an approximation.
 */
export async function planQuotes(env: Env, now = Date.now()): Promise<{
  currency: 'SAT';
  anchor_currency: string;
  step_sats: number;
  quoted_at: number | null;
  plans: {
    plan: PaidPlan;
    price_sats: number | null;
    price_minor: number;
  }[];
}> {
  const catalog = planCatalog(env);
  const rate = await currentRateMinor(env, now);
  const step = satStep(env);
  return {
    currency: 'SAT',
    anchor_currency: anchorCurrency(env),
    step_sats: step,
    quoted_at: rate === null ? null : now,
    // Cloud only. Cloud+ was withdrawn: it sold Deep Research, and Deep
    // Research could not do research. The relay never decrypts, so Venice's
    // search subsystem cannot read the question it would have to search for,
    // and accepts enable_web_search only to ignore it. Selling a name the
    // product does not honour is worse than selling one plan.
    plans: SELLABLE_PLANS.map(plan => ({
      plan,
      price_sats: rate === null
        ? null
        : satsForMinor(catalog[plan].priceCents, rate, step),
      price_minor: catalog[plan].priceCents,
    })),
  };
}

export async function getPlanQuotes(_request: Request, env: Env) {
  return planQuotes(env);
}

/**
 * Every plan on sale. One, and the list rather than a bare check because a
 * second one is a data change here and nowhere else.
 */
const SELLABLE_PLANS: PaidPlan[] = ['cloud'];

function parsePaidPlan(value: unknown): PaidPlan {
  if (SELLABLE_PLANS.includes(value as PaidPlan)) return value as PaidPlan;
  throw new AccountHttpError(400, 'invalid_plan', 'Choose a valid Alice plan.');
}

function parseMonths(value: unknown): number {
  const months = typeof value === 'number' ? value : Number(value ?? 1);
  if (!Number.isInteger(months) || months < 1 || months > MAX_PREPAID_MONTHS) {
    throw new AccountHttpError(
      400,
      'invalid_months',
      `Choose between 1 and ${MAX_PREPAID_MONTHS} months.`,
    );
  }
  return months;
}

/**
 * The plan an account actually holds right now.
 *
 * `entitlements.plan` records what was bought and is never rewritten on
 * expiry, so the effective plan is always a function of the clock. Every gate
 * goes through here rather than reading the column directly.
 */
export function effectivePlan(row: EntitlementRow, now: number): Plan {
  if (row.plan === 'free') return 'free';
  if (row.plan_expires_at !== null && row.plan_expires_at > now) {
    return row.plan as PaidPlan;
  }
  return 'free';
}

/**
 * Start of the current allowance period, renewed every 30 days while the plan
 * is active. Someone who prepays six months gets six renewals for free, with
 * no scheduled job and nothing to reconcile.
 */
function currentPeriodStart(usage: UsageRow, now: number): number | null {
  if (usage.period_started_at === null) return null;
  const elapsed = now - usage.period_started_at;
  if (elapsed < 0) return usage.period_started_at;
  const periods = Math.floor(elapsed / BILLING_PERIOD_MS);
  return usage.period_started_at + periods * BILLING_PERIOD_MS;
}

async function loadEntitlement(env: Env, userId: string): Promise<EntitlementRow> {
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT
      plan, plan_expires_at, cloud_enabled, free_cloud_requests_limit,
      input_bytes_limit, output_bytes_limit
    FROM entitlements
    WHERE user_id = ?
  `).bind(userId).first<EntitlementRow>();
  if (!row) {
    throw new AccountHttpError(404, 'account_not_found', 'Alice account not found.');
  }
  return row;
}

async function loadUsage(env: Env, userId: string): Promise<UsageRow> {
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT input_bytes_used, output_bytes_used, period_started_at
    FROM usage_counters
    WHERE user_id = ?
  `).bind(userId).first<UsageRow>();
  return row ?? {
    input_bytes_used: 0,
    output_bytes_used: 0,
    period_started_at: null,
  };
}

/**
 * Roll the byte counters over when the period has elapsed.
 *
 * Called on the request path rather than from a cron so an allowance renews
 * the moment it is due, even if the hourly job is late or a user's period
 * boundary falls between two runs.
 */
async function rollPeriod(env: Env, userId: string, usage: UsageRow, now: number): Promise<UsageRow> {
  const periodStart = currentPeriodStart(usage, now);
  if (periodStart === null || periodStart === usage.period_started_at) return usage;
  await env.ACCOUNT_DB.prepare(`
    UPDATE usage_counters
    SET
      input_bytes_used = 0,
      output_bytes_used = 0,
      period_started_at = ?,
      version = version + 1,
      updated_at = ?
    WHERE user_id = ? AND period_started_at = ?
  `).bind(periodStart, now, userId, usage.period_started_at).run();
  return {
    input_bytes_used: 0,
    output_bytes_used: 0,
    period_started_at: periodStart,
  };
}

/**
 * The plan to meter this request against. Free accounts keep the request
 * counter they have always had; paid ones move to byte metering.
 */
export async function resolvePlan(env: Env, userId: string, now = Date.now()): Promise<Plan> {
  return effectivePlan(await loadEntitlement(env, userId), now);
}

export async function getBillingSnapshot(
  env: Env,
  userId: string,
  now = Date.now(),
): Promise<BillingSnapshot> {
  const entitlement = await loadEntitlement(env, userId);
  const usage = await rollPeriod(env, userId, await loadUsage(env, userId), now);
  const plan = effectivePlan(entitlement, now);
  // The address the account already carries. There is no billing-specific one
  // any more: asking a second time for what is already on file was friction
  // that bought nothing.
  const contact = await accountEmailMasked(env, userId);
  const periodStart = currentPeriodStart(usage, now);

  // One figure, not two, because a user cannot act on two independent gauges.
  // The plan runs out when either budget does, so the honest number to show is
  // whichever is further along.
  const usagePercent = plan === 'free'
    ? null
    : Math.min(100, Math.round(Math.max(
      entitlement.input_bytes_limit > 0
        ? (usage.input_bytes_used / entitlement.input_bytes_limit) * 100
        : 0,
      entitlement.output_bytes_limit > 0
        ? (usage.output_bytes_used / entitlement.output_bytes_limit) * 100
        : 0,
    )));

  return {
    plan,
    purchased_plan: entitlement.plan as Plan,
    plan_expires_at: entitlement.plan_expires_at,
    expired: entitlement.plan !== 'free' && plan === 'free',
    period_started_at: periodStart,
    period_ends_at: periodStart === null ? null : periodStart + BILLING_PERIOD_MS,
    usage_percent: usagePercent,
    input_bytes_used: usage.input_bytes_used,
    input_bytes_limit: entitlement.input_bytes_limit,
    output_bytes_used: usage.output_bytes_used,
    output_bytes_limit: entitlement.output_bytes_limit,
    billing_email_masked: contact?.masked ?? null,
  };
}

export async function getCurrentBilling(request: Request, env: Env): Promise<BillingSnapshot> {
  const user = await authenticate(request, env);
  return getBillingSnapshot(env, user.userId);
}

// ---------------------------------------------------------------------------
// Byte metering
// ---------------------------------------------------------------------------

/**
 * Take a worst-case charge before relaying a paid request.
 *
 * Input size is known exactly. Output size is not, and cannot be known until
 * the stream ends, so the ceiling implied by `max_tokens` is reserved up front
 * and replaced by the real figure at settlement. Reserving high means a
 * request that dies mid-stream errs against the house's favour only after
 * settlement, never before, and a user can never overshoot their budget by
 * starting many requests at once.
 */
export async function reserveCloudBytes(
  env: Env,
  userId: string,
  idempotencyKey: string,
  inputBytes: number,
  maxOutputTokens: number,
): Promise<ByteReservation> {
  const now = Date.now();
  const ledgerId = uuid();
  const reservedOutputBytes = Math.ceil(maxOutputTokens * bytesPerToken(env));
  const entitlement = await loadEntitlement(env, userId);
  if (entitlement.cloud_enabled !== 1) {
    throw new AccountHttpError(403, 'cloud_disabled', 'Private Cloud is disabled on this account.');
  }
  const usage = await rollPeriod(env, userId, await loadUsage(env, userId), now);

  if (
    usage.input_bytes_used + inputBytes > entitlement.input_bytes_limit
    || usage.output_bytes_used + reservedOutputBytes > entitlement.output_bytes_limit
  ) {
    throw new AccountHttpError(
      402,
      'plan_quota_exhausted',
      'This month\'s Private Cloud allowance is used up.',
    );
  }

  const inserted = await env.ACCOUNT_DB.prepare(`
    INSERT OR IGNORE INTO cloud_request_ledger (
      id, user_id, idempotency_key, request_type, status, units,
      input_bytes, reserved_output_bytes, output_bytes, created_at
    ) VALUES (?, ?, ?, 'standard', 'reserved', 0, ?, ?, 0, ?)
  `).bind(
    ledgerId,
    userId,
    idempotencyKey,
    inputBytes,
    reservedOutputBytes,
    now,
  ).run();

  // A retried request id must not be charged twice. The unique constraint on
  // (user_id, idempotency_key) makes the second insert a no-op, and the
  // counters are only moved when the insert actually created the row.
  if ((inserted.meta.changes ?? 0) === 1) {
    await env.ACCOUNT_DB.prepare(`
      UPDATE usage_counters
      SET
        input_bytes_used = input_bytes_used + ?,
        output_bytes_used = output_bytes_used + ?,
        version = version + 1,
        updated_at = ?
      WHERE user_id = ?
    `).bind(inputBytes, reservedOutputBytes, now, userId).run();
  }

  const ledger = await env.ACCOUNT_DB.prepare(`
    SELECT id, reserved_output_bytes, input_bytes, status
    FROM cloud_request_ledger
    WHERE user_id = ? AND idempotency_key = ?
  `).bind(userId, idempotencyKey).first<{
    id: string;
    reserved_output_bytes: number;
    input_bytes: number;
    status: string;
  }>();
  if (!ledger) {
    throw new AccountHttpError(500, 'reservation_failed', 'Could not reserve this request.');
  }
  // The same replay the free path refuses, for the same reason. Here the
  // ceiling that goes missing is the month's byte allowance rather than the
  // twenty-one requests, so a five-euro plan bought an unbounded amount of
  // inference. See reserveFreeRequest for the full account.
  if ((inserted.meta.changes ?? 0) !== 1 && ledger.status === 'confirmed') {
    throw new AccountHttpError(
      409,
      'request_id_replayed',
      'This Alice request identifier was already answered. Send a new one.',
    );
  }
  // Read back from the row rather than trusting the argument: on a retried
  // request id the insert was a no-op, and what was charged is what the
  // original row says, not what this call asked for.
  return {
    ledgerId: ledger.id,
    inputBytes: ledger.input_bytes,
    reservedOutputBytes: ledger.reserved_output_bytes,
  };
}

/**
 * Replace the reserved output charge with what actually went over the wire.
 *
 * Called once the response stream ends. The difference is almost always a
 * refund, since few answers reach the token ceiling.
 */
export async function settleCloudBytes(
  env: Env,
  reservation: ByteReservation,
  actualOutputBytes: number,
): Promise<void> {
  const now = Date.now();
  const delta = actualOutputBytes - reservation.reservedOutputBytes;
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      UPDATE usage_counters
      SET
        output_bytes_used = MAX(0, output_bytes_used + ?),
        version = version + 1,
        updated_at = ?
      WHERE user_id = (
        SELECT user_id FROM cloud_request_ledger
        WHERE id = ? AND status = 'reserved'
      )
    `).bind(delta, now, reservation.ledgerId),
    env.ACCOUNT_DB.prepare(`
      UPDATE cloud_request_ledger
      SET status = 'confirmed', output_bytes = ?, confirmed_at = ?
      WHERE id = ? AND status = 'reserved'
    `).bind(actualOutputBytes, now, reservation.ledgerId),
  ]);
}

/** Give back the whole reservation when the relay never produced an answer. */
export async function refundCloudBytes(
  env: Env,
  reservation: ByteReservation,
  failureCode: string,
): Promise<void> {
  const now = Date.now();
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      UPDATE usage_counters
      SET
        input_bytes_used = MAX(0, input_bytes_used - ?),
        output_bytes_used = MAX(0, output_bytes_used - ?),
        version = version + 1,
        updated_at = ?
      WHERE user_id = (
        SELECT user_id FROM cloud_request_ledger
        WHERE id = ? AND status = 'reserved'
      )
    `).bind(
      reservation.inputBytes,
      reservation.reservedOutputBytes,
      now,
      reservation.ledgerId,
    ),
    env.ACCOUNT_DB.prepare(`
      UPDATE cloud_request_ledger
      SET status = 'refunded', refunded_at = ?, failure_code = ?
      WHERE id = ? AND status = 'reserved'
    `).bind(now, failureCode.slice(0, 64), reservation.ledgerId),
  ]);
}

/**
 * Write down what a request weighed, without charging anyone for it.
 *
 * Free requests are metered in requests, not bytes, so nothing in their path
 * needed a byte figure. That left the calibration ratio unverifiable: Venice
 * reports tokens, Alice reported nothing to compare them against, and the only
 * way to start measuring would have been to sell plans first and check the
 * arithmetic afterwards.
 *
 * So the free path now records the same two numbers, on the ledger row it
 * already creates, and moves no counter at all. It is measurement, not
 * metering: a free request that weighs a lot still costs exactly one request.
 */
export async function recordMeasuredBytes(
  env: Env,
  ledgerId: string,
  inputBytes: number,
  outputBytes: number,
): Promise<void> {
  await env.ACCOUNT_DB.prepare(`
    UPDATE cloud_request_ledger
    SET input_bytes = ?, output_bytes = ?
    WHERE id = ?
  `).bind(inputBytes, outputBytes, ledgerId).run();
}

/**
 * Count bytes as they stream past, without buffering or inspecting them.
 *
 * `done` resolves with the total once the stream ends, so settlement can run
 * in `ctx.waitUntil` after the response has already reached the user.
 */
export function countingStream(): {
  stream: TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>;
  done: Promise<number>;
} {
  let total = 0;
  let finish: (value: number) => void = () => {};
  const done = new Promise<number>(resolve => { finish = resolve; });
  const stream = new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      finish(total);
    },
    cancel() {
      finish(total);
    },
  });
  return { stream, done };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

function btcpayConfigured(env: Env): boolean {
  return Boolean(env.BTCPAY_BASE_URL && env.BTCPAY_STORE_ID && env.BTCPAY_API_KEY);
}

/**
 * Never hand a buyer a payment link less secure than the endpoint that issued
 * it.
 *
 * BTCPay builds its links from the protocol it believes it is being served
 * over, and behind a proxy that terminates TLS it usually believes plain HTTP.
 * The result is a real payment page reached over a plain link, which is both a
 * downgrade and exactly the shape of a scam a careful buyer is right to refuse.
 *
 * Alice already knows better: she reached BTCPay over `BTCPAY_BASE_URL`, so if
 * that was HTTPS the link to the same host can only be HTTPS too. Anything
 * pointing elsewhere is returned untouched and left to fail visibly rather than
 * being quietly rewritten.
 */
export function secureCheckoutLink(baseUrl: string, link: string): string {
  try {
    const base = new URL(baseUrl);
    const target = new URL(link);
    if (base.protocol !== 'https:') return link;
    if (target.hostname !== base.hostname) return link;
    if (target.protocol === 'https:') return link;
    target.protocol = 'https:';
    // A link built on the default HTTP port carries no port of its own; leaving
    // :80 on an HTTPS URL would point at a port nothing serves.
    if (target.port === '80') target.port = '';
    return target.toString();
  } catch {
    return link;
  }
}

/**
 * Create a BTCPay invoice and record it as pending.
 *
 * Nothing is credited here. Only the webhook, which BTCPay signs, may move an
 * entitlement: a client that closes the payment page, replays the response or
 * forges a success has no path to a paid plan.
 */
export async function createCheckout(request: Request, env: Env) {
  const now = Date.now();
  const user = await authenticate(request, env);
  const body = await parseJsonBody(request);
  const plan = parsePaidPlan(body.plan);
  const months = parseMonths(body.months);

  if (!btcpayConfigured(env)) {
    throw new AccountHttpError(503, 'billing_unavailable', 'Payments are not available yet.');
  }
  await rateLimit(env, await requestIpBucket(request, env, now), 'ip_checkout', 20, now);

  const definition = planCatalog(env)[plan];
  const amountCents = definition.priceCents * months;

  // The invoice is denominated in bitcoin, for exactly the figure the app
  // quoted. Letting BTCPay convert from euros at its own rate would put a
  // different number on the payment page than the one the buyer agreed to,
  // and there is no reading of that which is not Alice moving the price after
  // the fact.
  const rateMinor = await currentRateMinor(env, now);
  if (rateMinor === null) {
    throw new AccountHttpError(503, 'billing_unavailable', 'Payments are not available yet.');
  }
  const amountSats = satsForMinor(amountCents, rateMinor, satStep(env));

  const invoiceId = uuid();
  const base = env.BTCPAY_BASE_URL!.replace(/\/+$/, '');

  let created: { id?: string; checkoutLink?: string };
  try {
    const response = await fetch(
      `${base}/api/v1/stores/${encodeURIComponent(env.BTCPAY_STORE_ID!)}/invoices`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${env.BTCPAY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: (amountSats / 100_000_000).toFixed(8),
          currency: 'BTC',
          // The only thing Alice puts on the invoice is her own reference. No
          // email, no username, no account identifier that BTCPay could use to
          // build a profile of who buys what.
          metadata: { orderId: invoiceId },
          checkout: { redirectURL: env.BILLING_RETURN_URL ?? undefined },
        }),
      },
    );
    if (!response.ok) {
      throw new AccountHttpError(502, 'billing_upstream_failed', 'Could not start the payment.');
    }
    created = await response.json();
  } catch (error) {
    if (error instanceof AccountHttpError) throw error;
    throw new AccountHttpError(502, 'billing_upstream_failed', 'Could not start the payment.');
  }

  if (!created.id || !created.checkoutLink) {
    throw new AccountHttpError(502, 'billing_upstream_failed', 'Could not start the payment.');
  }

  await env.ACCOUNT_DB.prepare(`
    INSERT INTO invoices (
      id, user_id, provider, provider_invoice_id, plan, months,
      amount_cents, amount_sats, currency, status, created_at, updated_at
    ) VALUES (?, ?, 'btcpay', ?, ?, ?, ?, ?, 'BTC', 'pending', ?, ?)
  `).bind(
    invoiceId, user.userId, created.id, plan, months,
    // Both: the satoshi figure is what was charged, the euro figure is what
    // the plan is worth, and they stop agreeing as soon as the rate moves.
    amountCents, amountSats, now, now,
  ).run();

  return {
    invoice_id: invoiceId,
    checkout_url: secureCheckoutLink(base, created.checkoutLink),
    plan,
    months,
    amount_sats: amountSats,
    currency: 'SAT',
  };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

async function verifyBtcpaySignature(env: Env, raw: string, header: string | null): Promise<boolean> {
  const secret = env.BTCPAY_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const provided = header.trim().toLowerCase().replace(/^sha256=/, '');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const expected = Array.from(new Uint8Array(signature), byte =>
    byte.toString(16).padStart(2, '0')).join('');
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Credit a paid invoice exactly once.
 *
 * Time is added to whatever remains rather than replacing it, so buying three
 * months with ten days left leaves three months and ten days. Losing prepaid
 * time because you renewed early would be the worst possible reward for
 * paying ahead.
 */
async function creditInvoice(env: Env, providerInvoiceId: string, now: number): Promise<void> {
  const invoice = await env.ACCOUNT_DB.prepare(`
    SELECT id, user_id, plan, months, credited_at
    FROM invoices
    WHERE provider_invoice_id = ?
  `).bind(providerInvoiceId).first<{
    id: string;
    user_id: string;
    plan: PaidPlan;
    months: number;
    credited_at: number | null;
  }>();
  if (!invoice || invoice.credited_at !== null) return;

  const claimed = await env.ACCOUNT_DB.prepare(`
    UPDATE invoices
    SET status = 'paid', credited_at = ?, updated_at = ?
    WHERE id = ? AND credited_at IS NULL
  `).bind(now, now, invoice.id).run();
  // BTCPay retries webhooks. Whichever delivery wins this UPDATE does the
  // crediting; the others find zero rows changed and stop here.
  if ((claimed.meta.changes ?? 0) !== 1) return;

  const definition = planCatalog(env)[invoice.plan as PaidPlan];
  const entitlement = await loadEntitlement(env, invoice.user_id);
  const currentExpiry = effectivePlan(entitlement, now) === 'free'
    ? now
    : entitlement.plan_expires_at ?? now;
  const expiresAt = currentExpiry + invoice.months * BILLING_PERIOD_MS;


  const usage = await loadUsage(env, invoice.user_id);
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare(`
      UPDATE entitlements
      SET
        plan = ?,
        plan_expires_at = ?,
        input_bytes_limit = ?,
        output_bytes_limit = ?,
        updated_at = ?
      WHERE user_id = ?
    `).bind(
      invoice.plan,
      expiresAt,
      definition.inputBytesLimit,
      definition.outputBytesLimit,
      now,
      invoice.user_id,
    ),
    // A first purchase starts the allowance period now. A renewal leaves the
    // existing period alone, so paying early never resets the counter and
    // never hands out a second allowance in the same month.
    env.ACCOUNT_DB.prepare(`
      UPDATE usage_counters
      SET
        period_started_at = COALESCE(period_started_at, ?),
        input_bytes_used = CASE WHEN period_started_at IS NULL THEN 0 ELSE input_bytes_used END,
        output_bytes_used = CASE WHEN period_started_at IS NULL THEN 0 ELSE output_bytes_used END,
        version = version + 1,
        updated_at = ?
      WHERE user_id = ?
    `).bind(usage.period_started_at ?? now, now, invoice.user_id),
  ]);
}

/**
 * BTCPay's webhook endpoint. Unauthenticated by design, signature-gated in
 * fact: an unsigned or badly signed body is rejected before anything is read
 * out of it.
 */
export async function handleBtcpayWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 32_768) {
    return new Response('payload too large', { status: 413 });
  }
  const signature = request.headers.get('btcpay-sig');
  if (!await verifyBtcpaySignature(env, raw, signature)) {
    return new Response('invalid signature', { status: 401 });
  }

  let event: { type?: string; invoiceId?: string };
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  if (!event.invoiceId) return new Response('ok');

  const now = Date.now();
  if (event.type === 'InvoiceSettled' || event.type === 'InvoicePaymentSettled') {
    await creditInvoice(env, event.invoiceId, now);
  } else if (event.type === 'InvoiceExpired' || event.type === 'InvoiceInvalid') {
    const status = event.type === 'InvoiceExpired' ? 'expired' : 'invalid';
    await env.ACCOUNT_DB.prepare(`
      UPDATE invoices
      SET status = ?, updated_at = ?
      WHERE provider_invoice_id = ? AND credited_at IS NULL
    `).bind(status, now, event.invoiceId).run();
  }
  return new Response('ok');
}

// ---------------------------------------------------------------------------
// Expiry reminders
// ---------------------------------------------------------------------------

function reminderEmail(daysLeft: number, expiresAt: number): {
  subject: string;
  text: string;
  html: string;
} {
  const date = new Date(expiresAt).toISOString().slice(0, 10);
  const subject = daysLeft > 0
    ? `Your Alice plan ends in ${daysLeft} days`
    : 'Your Alice plan ends today';
  const lead = daysLeft > 0
    ? `Your Alice plan ends on ${date}, in ${daysLeft} days.`
    : `Your Alice plan ends today, ${date}.`;
  const body = `${lead} Bitcoin payments cannot renew on their own, so nothing will be charged and nothing will happen unless you renew it yourself. Open Alice and go to your account to pay for another month. Your wallet, your local AI and your data are unaffected either way.`;
  return {
    subject,
    text: `${body}\n\nYou are receiving this because you added this address for renewal reminders. You can remove it from your account at any time.`,
    html: `<p>${body}</p><p style="color:#666;font-size:13px">You are receiving this because you added this address for renewal reminders. You can remove it from your account at any time.</p>`,
  };
}

/**
 * Send the two renewal reminders, J-3 and expiry day.
 *
 * Run from the hourly cron. Every send is recorded first, so a cron that runs
 * twice, or a deploy that replays an hour, cannot mail anyone twice. The
 * reminder row is keyed on the expiry it refers to, so renewing moves the
 * expiry and the next cycle's reminders are naturally new rows.
 */
export async function sendExpiryReminders(env: Env, now = Date.now()): Promise<number> {
  if (!emailVaultConfigured(env)) return 0;
  const due = await env.ACCOUNT_DB.prepare(`
    SELECT
      entitlements.user_id AS user_id,
      entitlements.plan_expires_at AS plan_expires_at,
      account_emails.email_ciphertext AS email_ciphertext
    FROM entitlements
    JOIN account_emails ON account_emails.user_id = entitlements.user_id
    JOIN users ON users.id = entitlements.user_id
    WHERE entitlements.plan <> 'free'
      AND entitlements.plan_expires_at IS NOT NULL
      AND entitlements.plan_expires_at > ?
      AND entitlements.plan_expires_at <= ?
      AND users.status = 'active'
    LIMIT 200
  `).bind(now, now + REMINDER_LEAD_MS).all<{
    user_id: string;
    plan_expires_at: number;
    email_ciphertext: string;
  }>();

  let sent = 0;
  for (const row of due.results) {
    const msLeft = row.plan_expires_at - now;
    const kind = msLeft > 24 * 60 * 60 * 1_000 ? 't_minus_3' : 'expiry_day';
    const claimed = await env.ACCOUNT_DB.prepare(`
      INSERT OR IGNORE INTO billing_reminders (user_id, plan_expires_at, kind, sent_at)
      VALUES (?, ?, ?, ?)
    `).bind(row.user_id, row.plan_expires_at, kind, now).run();
    if ((claimed.meta.changes ?? 0) !== 1) continue;

    const email = await decryptEmail(env, row.email_ciphertext);
    if (!email) continue;
    const daysLeft = Math.max(0, Math.round(msLeft / (24 * 60 * 60 * 1_000)));
    try {
      await sendAccountEmail(env, email, reminderEmail(daysLeft, row.plan_expires_at));
      sent += 1;
    } catch {
      // A failed send must not retry forever or block the other reminders.
      // Dropping the row lets the next cron run try again, once.
      await env.ACCOUNT_DB.prepare(`
        DELETE FROM billing_reminders
        WHERE user_id = ? AND plan_expires_at = ? AND kind = ?
      `).bind(row.user_id, row.plan_expires_at, kind).run();
    }
  }
  return sent;
}

/**
 * Housekeeping for the billing tables, called from the same cron as the rest
 * of the account cleanup.
 */
export async function cleanupBillingData(env: Env, now = Date.now()): Promise<void> {
  await env.ACCOUNT_DB.batch([
    // The address is no longer deleted when a plan lapses. It belongs to the
    // account now, not to the purchase, and someone whose plan ran out is
    // precisely the person who might want to hear that it did. It goes when
    // the account goes, by cascade.
    env.ACCOUNT_DB.prepare(`
      DELETE FROM billing_reminders WHERE sent_at < ?
    `).bind(now - REMINDER_LOG_RETENTION_MS),
    env.ACCOUNT_DB.prepare(`
      UPDATE invoices
      SET status = 'expired', updated_at = ?
      WHERE status = 'pending' AND credited_at IS NULL AND created_at < ?
    `).bind(now, now - 24 * 60 * 60 * 1_000),
  ]);
}
