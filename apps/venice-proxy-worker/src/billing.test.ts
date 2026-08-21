import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Miniflare } from 'miniflare';
import { type Env } from './index.ts';
import { hmac, reserveFreeRequest, uuid } from './account.ts';
import {
  BILLING_PERIOD_MS,
  recordMeasuredBytes,
  bytesPerToken,
  cleanupBillingData,
  countingStream,
  createCheckout,
  getBillingSnapshot,
  handleBtcpayWebhook,
  planCatalog,
  refundCloudBytes,
  reserveCloudBytes,
  secureCheckoutLink,
  resolvePlan,
  sendExpiryReminders,
  settleCloudBytes,
} from './billing.ts';
import { rememberAccountEmail } from './account-email.ts';

let miniflare: Miniflare;
let db: D1Database;
let env: Env;
let sentEmails: { to: string; subject: string; text: string }[] = [];

const AUTH_SECRET = 'alice-test-hmac-secret-with-more-than-thirty-two-bytes';
const WEBHOOK_SECRET = 'btcpay-webhook-secret-for-tests';
const DAY_MS = 24 * 60 * 60 * 1_000;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { async fetch() { return new Response("ok") } }',
    d1Databases: ['ACCOUNT_DB'],
  });
  db = await miniflare.getD1Database('ACCOUNT_DB');
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  const migrationNames = (await readdir(migrationsUrl))
    .filter(name => /^\d+.*\.sql$/.test(name))
    .sort();
  for (const migrationName of migrationNames) {
    const migration = await readFile(new URL(migrationName, migrationsUrl), 'utf8');
    for (const statement of migration.split(/;\s*(?:\n|$)/).map(sql => sql.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  sentEmails = [];
  env = {
    ACCOUNT_DB: db,
    EMAIL: {
      async send(message: { to: string; subject: string; text: string }) {
        sentEmails.push(message);
        return { messageId: 'message-test' };
      },
    } as any,
    AUTH_EMAIL_FROM: 'login@alice.example',
    AUTH_HMAC_KEY: AUTH_SECRET,
    VENICE_API_KEY: 'venice-test',
    ALLOWED_ORIGINS: 'https://alice.example',
    BTCPAY_BASE_URL: 'https://btcpay.test',
    BTCPAY_STORE_ID: 'store-test',
    BTCPAY_API_KEY: 'btcpay-api-key',
    BTCPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    BILLING_EMAIL_KEY: 'billing-email-key-for-tests-0123456789',
  } as Env;

  // A fixed rate, so every satoshi figure in these tests is arithmetic rather
  // than whatever bitcoin happened to be worth when they ran. 90 000 EUR per
  // coin: a 5 EUR plan quotes 5 555.55 sats, which the 100 sat step rounds to
  // 5 600.
  await db.prepare(`
    INSERT INTO sat_price_pin (currency, rate_minor, pinned_at) VALUES ('EUR', ?, ?)
  `).bind(9_000_000, Date.now()).run();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await miniflare.dispose();
});

/** An active account with a usable session token. */
async function createUser(): Promise<{ userId: string; token: string }> {
  const now = Date.now();
  const userId = uuid();
  const token = 'a'.repeat(43);
  await db.batch([
    db.prepare(`
      INSERT INTO users (id, status, created_at, updated_at) VALUES (?, 'active', ?, ?)
    `).bind(userId, now, now),
    db.prepare(`
      INSERT INTO entitlements (
        user_id, plan, cloud_enabled, free_cloud_requests_limit,
        input_bytes_limit, output_bytes_limit,
        created_at, updated_at
      ) VALUES (?, 'free', 1, 21, 0, 0, ?, ?)
    `).bind(userId, now, now),
    db.prepare(`
      INSERT INTO usage_counters (user_id, free_cloud_requests_used, version, updated_at)
      VALUES (?, 0, 0, ?)
    `).bind(userId, now),
    db.prepare(`
      INSERT INTO sessions (
        id, user_id, access_token_hash, access_expires_at,
        refresh_token_hash, refresh_expires_at, created_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      uuid(),
      userId,
      await hmac(env, `access:${token}`),
      now + 15 * 60 * 1_000,
      await hmac(env, `refresh:${token}`),
      now + 30 * DAY_MS,
      now,
      now,
    ),
  ]);
  return { userId, token };
}

function authedRequest(path: string, body: unknown, token: string, method = 'POST') {
  return new Request(`https://proxy.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.8',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function signedWebhook(event: Record<string, unknown>): Promise<Request> {
  const raw = JSON.stringify(event);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
  return new Request('https://proxy.test/billing/webhook/btcpay', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'btcpay-sig': `sha256=${hex}` },
    body: raw,
  });
}

/** Put an invoice straight into the pending state a checkout would leave it in. */
async function pendingInvoice(
  userId: string,
  plan: 'cloud',
  months: number,
  providerInvoiceId: string,
) {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO invoices (
      id, user_id, provider, provider_invoice_id, plan, months,
      amount_cents, currency, status, created_at, updated_at
    ) VALUES (?, ?, 'btcpay', ?, ?, ?, ?, 'EUR', 'pending', ?, ?)
  `).bind(
    uuid(),
    userId,
    providerInvoiceId,
    plan,
    months,
    planCatalog(env)[plan].priceCents * months,
    now,
    now,
  ).run();
}

describe('the payment link handed to a buyer', () => {
  const base = 'https://btcpay.alicebtc.com';

  it('upgrades the link BTCPay built over plain HTTP', () => {
    // BTCPay behind a proxy that terminates TLS believes it is serving plain
    // HTTP and builds its links accordingly. Alice reached it over HTTPS, so
    // she knows better than the link she was handed.
    assert.equal(
      secureCheckoutLink(base, 'http://btcpay.alicebtc.com/i/ABC123'),
      'https://btcpay.alicebtc.com/i/ABC123',
    );
  });

  it('drops the port when it was only the default HTTP one', () => {
    // Carrying :80 onto an HTTPS URL would point at a port nothing serves.
    assert.equal(
      secureCheckoutLink(base, 'http://btcpay.alicebtc.com:80/i/ABC123'),
      'https://btcpay.alicebtc.com/i/ABC123',
    );
  });

  it('leaves a link that is already secure exactly as it is', () => {
    const link = 'https://btcpay.alicebtc.com/i/ABC123';
    assert.equal(secureCheckoutLink(base, link), link);
  });

  it('refuses to rewrite a link pointing somewhere else', () => {
    // Silently upgrading a link to another host would be Alice deciding that a
    // stranger's site is safe. It is returned untouched, to fail in the open.
    const elsewhere = 'http://not-my-btcpay.example.com/i/ABC123';
    assert.equal(secureCheckoutLink(base, elsewhere), elsewhere);
  });

  it('changes nothing when Alice herself reached BTCPay over plain HTTP', () => {
    // Local development against a plain-HTTP BTCPay must keep working: there
    // is no HTTPS to promise there, so promising it would just break the link.
    const link = 'http://192.168.0.23:3003/i/ABC123';
    assert.equal(secureCheckoutLink('http://192.168.0.23:3003', link), link);
  });

  it('survives a link that is not a URL at all', () => {
    assert.equal(secureCheckoutLink(base, 'not a url'), 'not a url');
  });
});

describe('checkout', () => {
  it('creates a pending invoice and never credits the plan itself', async () => {
    const { userId, token } = await createUser();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: 'btcpay-invoice-1',
      checkoutLink: 'https://btcpay.test/i/btcpay-invoice-1',
    }))) as typeof fetch;

    const result = await createCheckout(
      authedRequest('/billing/checkout', { plan: 'cloud', months: 3 }, token),
      env,
    );
    // Quoted in satoshis, never in euros: 1 500 cents at 90 000 EUR per coin.
    assert.equal(result.amount_sats, 16_700);
    assert.equal(result.currency, 'SAT');
    assert.equal(result.months, 3);
    assert.match(result.checkout_url, /btcpay\.test/);

    // Paying is what grants the plan. Asking for an invoice grants nothing.
    assert.equal(await resolvePlan(env, userId), 'free');
    const invoice = await db.prepare(
      'SELECT status, credited_at FROM invoices WHERE user_id = ?',
    ).bind(userId).first<{ status: string; credited_at: number | null }>();
    assert.equal(invoice?.status, 'pending');
    assert.equal(invoice?.credited_at, null);
  });

  it('refuses a month count outside the allowed range', async () => {
    const { token } = await createUser();
    await assert.rejects(
      createCheckout(authedRequest('/billing/checkout', { plan: 'cloud', months: 99 }, token), env),
      /1 and 24 months/,
    );
  });
});

describe('webhook', () => {
  it('rejects a body whose signature does not match', async () => {
    const { userId } = await createUser();
    await pendingInvoice(userId, 'cloud', 1, 'btcpay-invoice-2');
    const response = await handleBtcpayWebhook(
      new Request('https://proxy.test/billing/webhook/btcpay', {
        method: 'POST',
        headers: { 'btcpay-sig': 'sha256=' + 'ff'.repeat(32) },
        body: JSON.stringify({ type: 'InvoiceSettled', invoiceId: 'btcpay-invoice-2' }),
      }),
      env,
    );
    assert.equal(response.status, 401);
    assert.equal(await resolvePlan(env, userId), 'free');
  });

  it('credits a settled invoice exactly once however often it is delivered', async () => {
    const { userId } = await createUser();
    await pendingInvoice(userId, 'cloud', 1, 'btcpay-invoice-3');
    const event = { type: 'InvoiceSettled', invoiceId: 'btcpay-invoice-3' };

    await handleBtcpayWebhook(await signedWebhook(event), env);
    const first = await getBillingSnapshot(env, userId);
    await handleBtcpayWebhook(await signedWebhook(event), env);
    await handleBtcpayWebhook(await signedWebhook(event), env);
    const third = await getBillingSnapshot(env, userId);

    assert.equal(first.plan, 'cloud');
    assert.equal(third.plan_expires_at, first.plan_expires_at);
  });

  it('adds prepaid months to the time already paid for', async () => {
    const { userId } = await createUser();
    await pendingInvoice(userId, 'cloud', 1, 'btcpay-invoice-4');
    await handleBtcpayWebhook(
      await signedWebhook({ type: 'InvoiceSettled', invoiceId: 'btcpay-invoice-4' }),
      env,
    );
    const afterFirst = await getBillingSnapshot(env, userId);

    await pendingInvoice(userId, 'cloud', 3, 'btcpay-invoice-5');
    await handleBtcpayWebhook(
      await signedWebhook({ type: 'InvoiceSettled', invoiceId: 'btcpay-invoice-5' }),
      env,
    );
    const afterSecond = await getBillingSnapshot(env, userId);

    // Renewing early must never destroy time already bought.
    assert.equal(
      afterSecond.plan_expires_at! - afterFirst.plan_expires_at!,
      3 * BILLING_PERIOD_MS,
    );
  });

  it('does not restart the allowance period when a plan is renewed', async () => {
    const { userId } = await createUser();
    await pendingInvoice(userId, 'cloud', 1, 'btcpay-invoice-6');
    await handleBtcpayWebhook(
      await signedWebhook({ type: 'InvoiceSettled', invoiceId: 'btcpay-invoice-6' }),
      env,
    );
    const started = (await getBillingSnapshot(env, userId)).period_started_at;

    await db.prepare('UPDATE usage_counters SET input_bytes_used = 1000 WHERE user_id = ?')
      .bind(userId).run();
    await pendingInvoice(userId, 'cloud', 1, 'btcpay-invoice-7');
    await handleBtcpayWebhook(
      await signedWebhook({ type: 'InvoiceSettled', invoiceId: 'btcpay-invoice-7' }),
      env,
    );

    const snapshot = await getBillingSnapshot(env, userId);
    assert.equal(snapshot.period_started_at, started);
    // Buying a second month early must not hand out a second allowance now.
    assert.equal(snapshot.input_bytes_used, 1000);
  });

  it('marks an expired invoice without granting anything', async () => {
    const { userId } = await createUser();
    await pendingInvoice(userId, 'cloud', 1, 'btcpay-invoice-8');
    await handleBtcpayWebhook(
      await signedWebhook({ type: 'InvoiceExpired', invoiceId: 'btcpay-invoice-8' }),
      env,
    );
    assert.equal(await resolvePlan(env, userId), 'free');
    const invoice = await db.prepare('SELECT status FROM invoices WHERE provider_invoice_id = ?')
      .bind('btcpay-invoice-8').first<{ status: string }>();
    assert.equal(invoice?.status, 'expired');
  });
});

describe('plan lifetime', () => {
  it('falls back to free the moment the plan expires', async () => {
    const { userId } = await createUser();
    const now = Date.now();
    await db.prepare(`
      UPDATE entitlements
      SET plan = 'cloud', plan_expires_at = ?, input_bytes_limit = 1000, output_bytes_limit = 1000
      WHERE user_id = ?
    `).bind(now + 1_000, userId).run();

    assert.equal(await resolvePlan(env, userId, now), 'cloud');
    assert.equal(await resolvePlan(env, userId, now + 2_000), 'free');

    // What was bought stays on record even once it stops granting anything.
    const snapshot = await getBillingSnapshot(env, userId, now + 2_000);
    assert.equal(snapshot.purchased_plan, 'cloud');
    assert.equal(snapshot.expired, true);
  });

  it('renews the byte allowance every period without a scheduled job', async () => {
    const { userId } = await createUser();
    const now = Date.now();
    await db.batch([
      db.prepare(`
        UPDATE entitlements
        SET plan = 'cloud', plan_expires_at = ?, input_bytes_limit = 10000, output_bytes_limit = 10000
        WHERE user_id = ?
      `).bind(now + 90 * DAY_MS, userId),
      db.prepare(`
        UPDATE usage_counters
        SET input_bytes_used = 9000, output_bytes_used = 9000, period_started_at = ?
        WHERE user_id = ?
      `).bind(now, userId),
    ]);

    const sameMonth = await getBillingSnapshot(env, userId, now + 10 * DAY_MS);
    assert.equal(sameMonth.input_bytes_used, 9000);

    const nextMonth = await getBillingSnapshot(env, userId, now + BILLING_PERIOD_MS + 1_000);
    assert.equal(nextMonth.input_bytes_used, 0);
    assert.equal(nextMonth.period_started_at, now + BILLING_PERIOD_MS);
  });
});

describe('byte metering', () => {
  async function paidUser(inputLimit = 1_000_000, outputLimit = 1_000_000) {
    const created = await createUser();
    const now = Date.now();
    await db.batch([
      db.prepare(`
        UPDATE entitlements
        SET plan = 'cloud', plan_expires_at = ?, input_bytes_limit = ?, output_bytes_limit = ?
        WHERE user_id = ?
      `).bind(now + 30 * DAY_MS, inputLimit, outputLimit, created.userId),
      db.prepare('UPDATE usage_counters SET period_started_at = ? WHERE user_id = ?')
        .bind(now, created.userId),
    ]);
    return created;
  }

  it('reserves the worst case, then charges what actually streamed back', async () => {
    const { userId } = await paidUser();
    const reservation = await reserveCloudBytes(env, userId, 'request-1', 4_000, 2_048);
    const reservedOutput = Math.ceil(2_048 * bytesPerToken(env));

    const afterReserve = await getBillingSnapshot(env, userId);
    assert.equal(afterReserve.input_bytes_used, 4_000);
    assert.equal(afterReserve.output_bytes_used, reservedOutput);

    await settleCloudBytes(env, reservation, 900);
    const afterSettle = await getBillingSnapshot(env, userId);
    assert.equal(afterSettle.input_bytes_used, 4_000);
    assert.equal(afterSettle.output_bytes_used, 900);
  });

  it('refuses a request id whose answer was already delivered', async () => {
    // Same replay the free path refuses, same reason. Here it was the month's
    // byte allowance that stopped bounding anything: settling marks the row
    // confirmed, and a second call carrying that id must not buy another turn
    // upstream on a ceiling it has already passed.
    const { userId } = await paidUser();
    const reservation = await reserveCloudBytes(env, userId, 'request-replay', 4_000, 100);
    await settleCloudBytes(env, reservation, 900);

    await assert.rejects(
      () => reserveCloudBytes(env, userId, 'request-replay', 4_000, 100),
      (error: any) => error.code === 'request_id_replayed' && error.status === 409,
    );

    const snapshot = await getBillingSnapshot(env, userId);
    assert.equal(snapshot.input_bytes_used, 4_000);
    assert.equal(snapshot.output_bytes_used, 900);
  });

  it('charges a repeated request id only once', async () => {
    const { userId } = await paidUser();
    await reserveCloudBytes(env, userId, 'request-2', 4_000, 100);
    await reserveCloudBytes(env, userId, 'request-2', 4_000, 100);
    const snapshot = await getBillingSnapshot(env, userId);
    assert.equal(snapshot.input_bytes_used, 4_000);
  });

  it('gives everything back when the relay never answered', async () => {
    const { userId } = await paidUser();
    const reservation = await reserveCloudBytes(env, userId, 'request-3', 4_000, 100);
    await refundCloudBytes(env, reservation, 'upstream_network_error');
    const snapshot = await getBillingSnapshot(env, userId);
    assert.equal(snapshot.input_bytes_used, 0);
    assert.equal(snapshot.output_bytes_used, 0);
  });

  it('refuses a request that would overshoot the allowance', async () => {
    const { userId } = await paidUser(5_000, 5_000);
    await reserveCloudBytes(env, userId, 'request-4', 4_000, 100);
    await assert.rejects(
      reserveCloudBytes(env, userId, 'request-5', 4_000, 100),
      /allowance is used up/,
    );
  });

  it('counts stream bytes without altering the stream', async () => {
    const chunks = ['data: one\n', 'data: two\n', 'data: three\n'];
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const counter = countingStream();
    const relayed = await new Response(source.pipeThrough(counter.stream as any)).text();

    assert.equal(relayed, chunks.join(''));
    assert.equal(await counter.done, new TextEncoder().encode(chunks.join('')).byteLength);
  });

  it('reports one honest percentage rather than two competing gauges', async () => {
    const { userId } = await paidUser(1_000, 1_000);
    await reserveCloudBytes(env, userId, 'request-6', 100, 0);
    const snapshot = await getBillingSnapshot(env, userId);
    assert.equal(snapshot.usage_percent, 10);
  });
});

describe('renewal reminders', () => {
  async function expiringUser(msUntilExpiry: number) {
    const created = await createUser();
    await db.prepare(`
      UPDATE entitlements
      SET plan = 'cloud', plan_expires_at = ?, input_bytes_limit = 1000, output_bytes_limit = 1000
      WHERE user_id = ?
    `).bind(Date.now() + msUntilExpiry, created.userId).run();
    return created;
  }

  it('sends nothing to an account that never gave an address', async () => {
    await expiringUser(2 * DAY_MS);
    assert.equal(await sendExpiryReminders(env), 0);
    assert.equal(sentEmails.length, 0);
  });

  it('stores the address encrypted and never in the clear', async () => {
    const { userId } = await expiringUser(2 * DAY_MS);
    await rememberAccountEmail(env, userId, 'someone@example.com', { verified: true });

    const row = await db.prepare(
      'SELECT email_ciphertext, email_masked FROM account_emails WHERE user_id = ?',
    ).bind(userId).first<{ email_ciphertext: string; email_masked: string }>();
    assert.ok(row);
    assert.equal(row!.email_masked, 'so*****@example.com');
    assert.ok(!row!.email_ciphertext.includes('someone'));
    assert.ok(!row!.email_ciphertext.includes('example.com'));
  });

  it('sends one reminder per deadline and never repeats it', async () => {
    const { userId } = await expiringUser(2 * DAY_MS);
    await rememberAccountEmail(env, userId, 'someone@example.com', { verified: true });

    assert.equal(await sendExpiryReminders(env), 1);
    assert.equal(await sendExpiryReminders(env), 0);
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'someone@example.com');
    assert.match(sentEmails[0].subject, /ends in 2 days/);
  });

  it('says nothing will be charged, because nothing can be', async () => {
    const { userId } = await expiringUser(4 * 60 * 60 * 1_000);
    await rememberAccountEmail(env, userId, 'someone@example.com', { verified: true });
    await sendExpiryReminders(env);
    assert.match(sentEmails[0].subject, /ends today/);
    assert.match(sentEmails[0].text, /nothing will be charged/);
  });

  it('ignores a plan that is not close to expiring', async () => {
    const { userId } = await expiringUser(20 * DAY_MS);
    await rememberAccountEmail(env, userId, 'someone@example.com', { verified: true });
    assert.equal(await sendExpiryReminders(env), 0);
  });
});

describe('measuring the free path', () => {
  it('writes down what a free request weighed without charging for it', async () => {
    // Venice reports tokens; Alice has to report bytes against them or the
    // calibration ratio stays a guess. Free traffic is the only traffic there
    // is before the first plan is sold, so it is the only place the ratio can
    // start being checked.
    const { userId } = await createUser();
    const reservation = await reserveFreeRequest(env, userId, 'measured-request');
    await recordMeasuredBytes(env, reservation.ledgerId, 4_096, 1_024);

    const row = await db.prepare(
      'SELECT input_bytes, output_bytes, units FROM cloud_request_ledger WHERE id = ?',
    ).bind(reservation.ledgerId).first<{
      input_bytes: number;
      output_bytes: number;
      units: number;
    }>();
    assert.equal(row?.input_bytes, 4_096);
    assert.equal(row?.output_bytes, 1_024);

    // And it stays one request, whatever it weighed.
    const usage = await db.prepare(
      'SELECT free_cloud_requests_used FROM usage_counters WHERE user_id = ?',
    ).bind(userId).first<{ free_cloud_requests_used: number }>();
    assert.equal(usage?.free_cloud_requests_used, 1);
  });

  it('leaves the byte allowance of a paid plan alone', async () => {
    // Measurement must never look like metering: this writes on one row and
    // moves nothing that any quota is computed from.
    const { userId } = await createUser();
    const reservation = await reserveFreeRequest(env, userId, 'measured-only');
    await recordMeasuredBytes(env, reservation.ledgerId, 9_999, 9_999);

    const counters = await db.prepare(
      'SELECT input_bytes_used, output_bytes_used FROM usage_counters WHERE user_id = ?',
    ).bind(userId).first<{ input_bytes_used: number; output_bytes_used: number }>();
    assert.equal(counters?.input_bytes_used, 0);
    assert.equal(counters?.output_bytes_used, 0);
  });
});

describe('billing data retention', () => {
  it('keeps the address after a plan lapses, because that is when it matters', async () => {
    // It used to be deleted a month after expiry, back when it existed only
    // for the purchase. It belongs to the account now, and someone whose plan
    // just ran out is exactly the person worth being able to reach.
    const { userId } = await createUser();
    await db.prepare(`
      UPDATE entitlements
      SET plan = 'cloud', plan_expires_at = ?
      WHERE user_id = ?
    `).bind(Date.now() - 60 * DAY_MS, userId).run();
    await rememberAccountEmail(env, userId, 'someone@example.com', { verified: true });

    await cleanupBillingData(env);
    const row = await db.prepare('SELECT user_id FROM account_emails WHERE user_id = ?')
      .bind(userId).first();
    assert.ok(row);
  });

  it('lets the address go when the account goes', async () => {
    const { userId } = await createUser();
    await rememberAccountEmail(env, userId, 'someone@example.com', { verified: true });
    await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
    const row = await db.prepare('SELECT user_id FROM account_emails WHERE user_id = ?')
      .bind(userId).first();
    assert.equal(row, null);
  });
});
