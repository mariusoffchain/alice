// Payment-host watch.
//
// The BTCPay instance is a separate service from this Worker. When it stops
// answering, nothing breaks visibly: the app keeps working, the checkout
// simply cannot open, and a customer who wanted to pay walks away without
// anyone knowing. This module is the part that knows.
//
// Two entry points, deliberately independent, because they fail differently:
//
//   1. An external uptime watcher calls POST /ops/tunnel-alert when it sees
//      the host go dark. Fast, but it only knows a probe failed; it cannot
//      tell a restart from an outage, so it asks this module to look.
//   2. The hourly cron checks on its own. Slower, but it catches what an
//      uptime probe never sees: a host that answers while BTCPay itself is
//      broken, an expired API key, a store that stopped accepting invoices.
//
// Both end in the same place: diagnose, then tell the operator once, on two
// channels, and tell them again when it comes back.
//
// Which watcher calls the route is an operator's choice and is not encoded
// here: anything able to POST with the shared secret works.
import { recordTechnicalEvent } from './admin.ts';
import type { Env } from './index.ts';

/** How long an alert silences its own repeats. */
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const PROBE_TIMEOUT_MS = 10_000;

type Diagnosis = {
  reachable: boolean;
  /** Set when BTCPay answers but cannot take a payment. */
  detail: string;
};

/**
 * BTCPay scopes a permission either to every store (`btcpay.store.x`) or to
 * one (`btcpay.store.x:STOREID`), and wider rights imply narrower ones:
 * modifying a store's settings, or administering the server, both include
 * creating its invoices. Exported for the test.
 */
export function canCreateInvoice(permissions: readonly string[], storeId: string): boolean {
  const implied = [
    'btcpay.store.cancreateinvoice',
    'btcpay.store.canmodifystoresettings',
    'btcpay.server.canmodifyserversettings',
  ];
  return permissions.some((granted) => {
    const [name, scope] = granted.split(':', 2);
    return implied.includes(name) && (scope === undefined || scope === storeId);
  });
}

/**
 * Asks BTCPay two questions in order, because they fail for different reasons
 * and the operator needs to know which one it is: is the host answering at
 * all, and is our API key still one that can create an invoice on our store.
 * The second catches a revoked key or a key re-issued without the right
 * permission, which a health endpoint never would.
 *
 * The key is asked about itself, not about the store. Reading the store
 * needs a permission Alice's key deliberately does not have (it can create
 * invoices and nothing else), and a probe that needs more rights than
 * checkout does reports an outage that checkout never sees. That is not a
 * hypothetical: it fired every six hours for a month while payments worked.
 */
export async function diagnoseBtcpay(env: Env): Promise<Diagnosis> {
  const base = env.BTCPAY_BASE_URL?.replace(/\/+$/, '');
  if (!base) return { reachable: false, detail: 'BTCPAY_BASE_URL is not configured.' };

  const withTimeout = (path: string, init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    return fetch(`${base}${path}`, { ...init, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  };

  try {
    const health = await withTimeout('/api/v1/health');
    if (!health.ok) {
      return { reachable: false, detail: `Health endpoint answered ${health.status}.` };
    }
  } catch (error) {
    // No answer at all: the service is down, unreachable, or its name no
    // longer resolves.
    return {
      reachable: false,
      detail: `No answer from the host (${error instanceof Error ? error.message : 'unknown error'}).`,
    };
  }

  if (!env.BTCPAY_STORE_ID || !env.BTCPAY_API_KEY) {
    return { reachable: true, detail: 'Host is up, but Alice has no store id or API key configured.' };
  }

  try {
    const key = await withTimeout('/api/v1/api-keys/current', {
      headers: { Authorization: `token ${env.BTCPAY_API_KEY}` },
    });
    if (key.status === 401 || key.status === 403) {
      return { reachable: false, detail: 'Host is up, but the API key is refused. Checkout cannot open.' };
    }
    if (!key.ok) {
      return { reachable: false, detail: `Host is up, but the API key could not be checked (${key.status}).` };
    }
    const info = await key.json() as { permissions?: unknown };
    const permissions = Array.isArray(info.permissions)
      ? info.permissions.filter((p): p is string => typeof p === 'string')
      : [];
    if (!canCreateInvoice(permissions, env.BTCPAY_STORE_ID)) {
      return {
        reachable: false,
        detail: 'Host is up, but the API key cannot create invoices on this store. Checkout cannot open.',
      };
    }
  } catch (error) {
    return {
      reachable: false,
      detail: `Host is up, but the API key could not be checked (${error instanceof Error ? error.message : 'unknown error'}).`,
    };
  }

  return { reachable: true, detail: 'Host answers and the API key can create invoices.' };
}

/** Was an alert of this kind already sent inside the cooldown window? */
async function alertedRecently(env: Env, code: string): Promise<boolean> {
  if (!env.ACCOUNT_DB) return false;
  try {
    const row = await env.ACCOUNT_DB.prepare(`
      SELECT created_at FROM technical_events
      WHERE category = 'venice' AND code = ?
      ORDER BY created_at DESC LIMIT 1
    `).bind(code).first<{ created_at: number }>();
    return Boolean(row && Date.now() - row.created_at < ALERT_COOLDOWN_MS);
  } catch {
    // Unknown means unsilenced: better a repeated alert than a missed outage.
    return false;
  }
}

async function sendMail(env: Env, subject: string, body: string): Promise<void> {
  const to = env.OPS_ALERT_EMAIL?.trim();
  if (!env.RESEND_API_KEY || !to) return;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.AUTH_EMAIL_FROM?.trim() || 'Alice <noreply@alicebtc.com>',
        to: [to],
        subject,
        text: body,
      }),
    });
    if (!response.ok) {
      // The refusal is logged, never the address: the Worker's logs are the
      // one place an operator can learn why an alert did not arrive.
      console.error('ops alert mail refused', response.status, (await response.text()).slice(0, 300));
    }
  } catch (error) {
    console.error('ops alert mail failed', error instanceof Error ? error.message : 'unknown error');
  }
}

async function sendTelegram(env: Env, body: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body }),
    });
    if (!response.ok) {
      console.error('ops alert telegram refused', response.status, (await response.text()).slice(0, 300));
    }
  } catch (error) {
    console.error('ops alert telegram failed', error instanceof Error ? error.message : 'unknown error');
  }
}

/**
 * Both channels, because an outage notice is only worth anything if it is
 * actually seen: mail is the record, Telegram is the one that buzzes. Each is
 * optional and each failure is swallowed, so a broken Telegram token can never
 * stop the mail from going out.
 */
async function notifyOps(env: Env, subject: string, body: string): Promise<void> {
  await Promise.allSettled([
    sendMail(env, subject, body),
    sendTelegram(env, `${subject}\n\n${body}`),
  ]);
}

/**
 * The shared path: look, then speak only when the news changed. Called by the
 * cron and by the external watcher, so a probe alert and a scheduled check
 * cannot double-notify for the same outage.
 */
export async function checkAndAlert(env: Env, trigger: 'cron' | 'watcher'): Promise<Diagnosis> {
  const diagnosis = await diagnoseBtcpay(env);
  const wasDown = await alertedRecently(env, 'btcpay_down');

  if (!diagnosis.reachable) {
    if (!wasDown) {
      await recordTechnicalEvent(env, 'venice', 'btcpay_down', 503);
      await notifyOps(
        env,
        'Alice: BTCPay is not answering',
        [
          'Payments cannot be taken right now.',
          '',
          `What happened: ${diagnosis.detail}`,
          `Noticed by: ${trigger === 'watcher' ? 'the external uptime watcher' : 'the hourly check'}`,
          `Time: ${new Date().toISOString()}`,
          '',
          'A customer opening the checkout will see it fail until this is back.',
        ].join('\n'),
      );
    }
    return diagnosis;
  }

  // Back up. Only worth saying if it had been reported down, otherwise this
  // would be an hourly "still fine" that teaches the operator to ignore it.
  if (wasDown) {
    await recordTechnicalEvent(env, 'venice', 'btcpay_up', 200);
    await notifyOps(
      env,
      'Alice: BTCPay is answering again',
      [`Payments can be taken again. ${diagnosis.detail}`, `Time: ${new Date().toISOString()}`].join('\n'),
    );
  }
  return diagnosis;
}

/**
 * Webhook for an external uptime watcher. It reports only that a probe
 * changed state; Alice decides what that means by asking BTCPay herself,
 * which is what stops a blip during a restart from becoming a false alarm.
 *
 * The shared secret rides in the path because a notification
 * webhook cannot carry custom headers. Without it configured, the route does
 * not exist at all rather than standing open.
 */
export async function handleTunnelAlert(request: Request, env: Env, secret: string): Promise<Response> {
  if (!env.OPS_ALERT_SECRET || secret !== env.OPS_ALERT_SECRET) {
    return new Response('not found', { status: 404 });
  }
  const diagnosis = await checkAndAlert(env, 'watcher');
  return new Response(JSON.stringify({ reachable: diagnosis.reachable }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
