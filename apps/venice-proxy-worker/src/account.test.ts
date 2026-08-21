import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Miniflare } from 'miniflare';
import worker, { type Env } from './index.ts';
import {
  AccountHttpError,
  authenticate,
  cleanupExpiredAccountData,
  confirmFreeRequest,
  getAccountSnapshot,
  maskEmail,
  normalizeEmail,
  refundFreeRequest,
  reserveFreeRequest,
} from './account.ts';

let miniflare: Miniflare;
let db: D1Database;
let sentCode = '';
let env: Env;

const AUTH_SECRET = 'alice-test-hmac-secret-with-more-than-thirty-two-bytes';
const INSTALL_ID = 'install-test-00000000000001';
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
  sentCode = '';
  env = {
    ACCOUNT_DB: db,
    EMAIL: {
      async send(message: { subject: string }) {
        sentCode = message.subject.match(/\b(\d{6})\b/)?.[1] ?? '';
        return { messageId: 'message-test' };
      },
    } as any,
    AUTH_EMAIL_FROM: 'login@alice.example',
    AUTH_HMAC_KEY: AUTH_SECRET,
    VENICE_API_KEY: 'venice-test',
    ALLOWED_ORIGINS: 'https://alice.example',
    FREE_CLOUD_MODELS: 'e2ee-gpt-oss-120b-p',
    FREE_CLOUD_MAX_TOKENS: '2048',
  };
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await miniflare.dispose();
});

function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  method = 'POST',
) {
  return new Request(`https://proxy.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.8',
      'x-alice-install-id': INSTALL_ID,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function createAccount(
  email = 'Marius+test@Example.com',
  headers: Record<string, string> = {},
) {
  // The deliberate path, same as the app: an anonymous session that chooses
  // to link this email. Bootstrapping through bare /auth/email/verify would
  // test a door that no longer exists, since signing in stopped creating the
  // account it could not find.
  const anonymous = await worker.fetch(jsonRequest('/auth/anonymous', {}, headers), env);
  assert.equal(anonymous.status, 200);
  const anonSession = await anonymous.json() as { access_token: string };
  const authed = { ...headers, authorization: `Bearer ${anonSession.access_token}` };

  const started = await worker.fetch(
    jsonRequest('/account/identities/email/start', { email }, authed),
    env,
  );
  assert.equal(started.status, 200);
  assert.match(sentCode, /^\d{6}$/);

  const linked = await worker.fetch(
    jsonRequest('/account/identities/email/verify', { email, code: sentCode }, authed),
    env,
  );
  assert.equal(linked.status, 200);
  const { account } = await linked.json() as {
    account: {
      user_id: string;
      cloud_requests_remaining: number;
      email_masked: string;
    };
  };
  return {
    access_token: anonSession.access_token,
    refresh_token: (anonSession as { refresh_token?: string }).refresh_token ?? '',
    account,
  };
}

async function startAndSignNostr(
  secretKey: Uint8Array,
  accessToken?: string,
) {
  const publicKey = hex(schnorr.getPublicKey(secretKey));
  const prefix = accessToken ? '/account/identities' : '/auth';
  const headers = accessToken
    ? { authorization: `Bearer ${accessToken}` }
    : {};
  const started = await worker.fetch(
    jsonRequest(`${prefix}/nostr/start`, { public_key: publicKey }, headers),
    env,
  );
  assert.equal(started.status, 200);
  const challenge = await started.json() as {
    challenge_id: string;
    challenge: string;
    verify_url: string;
    kind: number;
  };
  const event = {
    pubkey: publicKey,
    created_at: Math.floor(Date.now() / 1_000),
    kind: challenge.kind,
    tags: [
      ['u', challenge.verify_url],
      ['method', 'POST'],
      ['challenge', challenge.challenge],
      ['alice_challenge', challenge.challenge_id],
    ],
    content: '',
  };
  const idBytes = sha256(new TextEncoder().encode(JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ])));
  const id = hex(idBytes);
  return {
    path: `${prefix}/nostr/verify`,
    headers,
    body: {
      challenge_id: challenge.challenge_id,
      event: {
        ...event,
        id,
        sig: hex(await schnorr.signAsync(idBytes, secretKey)),
      },
    },
  };
}

/**
 * An account with a username and a password, built the way the apps build one:
 * an address first, proved by a code, then a name and a password added to that
 * account. There is no route that mints a password-only account any more,
 * because there is no account without a reachable address any more.
 */
async function createNamedAccount(options: {
  email: string;
  prefix: string;
  suffix: string;
  username?: string;
  display_name?: string;
  password: string;
  installId?: string;
}) {
  const headers = options.installId
    ? { 'x-alice-install-id': options.installId }
    : {};
  const created = await createAccount(options.email, headers);
  const response = await worker.fetch(
    jsonRequest('/account/password', {
      password: options.password,
      prefix: options.prefix,
      suffix: options.suffix,
      username: options.username,
      display_name: options.display_name,
    }, { authorization: `Bearer ${created.access_token}` }, 'PUT'),
    env,
  );
  return { response, access_token: created.access_token };
}

describe('email account', () => {
  it('normalizes and masks email without using it as the user id', () => {
    assert.equal(normalizeEmail(' Marius+Alice@Example.COM '), 'marius+alice@example.com');
    assert.equal(maskEmail('marius@example.com'), 'ma****@example.com');
    assert.throws(() => normalizeEmail('not-an-email'), AccountHttpError);
  });

  it('can send the OTP through Resend without exposing its key to the client', async () => {
    let outbound: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      outbound = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ id: 'email-test' }), { status: 200 });
    }) as typeof fetch;
    const resendEnv = {
      ...env,
      EMAIL: undefined as any,
      AUTH_EMAIL_PROVIDER: 'resend',
      AUTH_EMAIL_FROM: 'login@auth.alicebtc.com',
      RESEND_API_KEY: 're_test_server_only',
    };

    const response = await worker.fetch(
      jsonRequest('/auth/email/start', { email: 'resend@example.com' }),
      resendEnv,
    );

    assert.equal(response.status, 200);
    assert.equal(outbound?.url, 'https://api.resend.com/emails');
    const headers = new Headers(outbound?.init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer re_test_server_only');
    const payload = JSON.parse(String(outbound?.init.body));
    assert.equal(payload.from, 'Alice <login@auth.alicebtc.com>');
    assert.deepEqual(payload.to, ['resend@example.com']);
    assert.match(payload.subject, /^\d{6} is your Alice login code$/);
    assert.ok(!(await response.text()).includes('re_test_server_only'));
  });

  it('removes the OTP challenge when the email provider rejects delivery', async () => {
    globalThis.fetch = (async () => new Response('rejected', { status: 500 })) as typeof fetch;
    const resendEnv = {
      ...env,
      EMAIL: undefined as any,
      AUTH_EMAIL_PROVIDER: 'resend',
      AUTH_EMAIL_FROM: 'login@auth.alicebtc.com',
      RESEND_API_KEY: 're_test_server_only',
    };

    const response = await worker.fetch(
      jsonRequest('/auth/email/start', { email: 'delivery-failure@example.com' }),
      resendEnv,
    );

    assert.equal(response.status, 502);
    assert.equal((await response.json() as any).error.code, 'email_delivery_failed');
    const row = await db.prepare(
      'SELECT COUNT(*) AS count FROM email_challenges',
    ).first<{ count: number }>();
    assert.equal(row?.count, 0);
  });

  it('writes down where the account can be reached, encrypted', async () => {
    // The address is captured on every code login, not only at creation, which
    // is what repairs accounts made back when Alice stored nothing but the
    // one-way lookup: their owner types the address to sign in anyway.
    env.ACCOUNT_EMAIL_KEY = 'account-email-key-for-tests-0123456789';
    const created = await createAccount('reachable@example.com');

    const row = await db.prepare(
      'SELECT email_ciphertext, email_masked, verified_at FROM account_emails WHERE user_id = ?',
    ).bind(created.account.user_id).first<{
      email_ciphertext: string;
      email_masked: string;
      verified_at: number | null;
    }>();
    assert.ok(row);
    assert.equal(row!.email_masked, 're******@example.com');
    assert.ok(row!.verified_at !== null, 'a code login proves the address');
    assert.ok(!row!.email_ciphertext.includes('reachable'));
    assert.ok(!row!.email_ciphertext.includes('example.com'));

    const snapshot = await getAccountSnapshot(env, created.account.user_id);
    assert.equal(snapshot.email_reachable, true);
    // Product mail starts on: a handful of messages a year about what the app
    // can now do, no longer hidden behind a switch nobody moved.
    assert.equal(snapshot.product_updates, true);
  });

  it('stores no address at all when there is no key to protect it', async () => {
    // Writing addresses in the clear because a secret is missing would be the
    // worst of both worlds: the property Alice gave up, without the protection
    // she gave it up for.
    delete env.ACCOUNT_EMAIL_KEY;
    delete env.BILLING_EMAIL_KEY;
    const created = await createAccount('unprotected@example.com');
    const row = await db.prepare('SELECT user_id FROM account_emails WHERE user_id = ?')
      .bind(created.account.user_id).first();
    assert.equal(row, null);
    assert.equal((await getAccountSnapshot(env, created.account.user_id)).email_reachable, false);
  });

  it('creates one opaque account after verification and starts at 21 requests', async () => {
    const first = await createAccount();
    assert.notEqual(first.account.user_id, 'marius+test@example.com');
    // Creation now graduates the installation's anonymous user rather than
    // minting a fresh uuid, so the id keeps the anonymous derivation shape.
    // What matters is what it never contains: the email, or anything
    // derivable from it.
    assert.match(first.account.user_id, /^(anon_[A-Za-z0-9_-]{43}|[0-9a-f-]{36})$/);
    assert.equal(first.account.cloud_requests_remaining, 21);
    assert.equal(first.account.email_masked, 'ma******@example.com');

    const authenticated = await authenticate(new Request('https://proxy.test/account', {
      headers: { authorization: `Bearer ${first.access_token}` },
    }), env);
    assert.equal(authenticated.userId, first.account.user_id);

    const accountResponse = await worker.fetch(new Request('https://proxy.test/account', {
      headers: { authorization: `Bearer ${first.access_token}` },
    }), env);
    assert.equal(accountResponse.status, 200);
    assert.equal((await accountResponse.json() as any).cloud_requests_remaining, 21);
  });

  it('grants anonymous access and keeps the quota when email converts the account', async () => {
    const anonymousResponse = await worker.fetch(
      jsonRequest('/auth/anonymous', {}),
      env,
    );
    assert.equal(anonymousResponse.status, 200);
    const anonymous = await anonymousResponse.json() as any;

    const beforeResponse = await worker.fetch(new Request('https://proxy.test/account', {
      headers: { authorization: `Bearer ${anonymous.access_token}` },
    }), env);
    assert.equal(beforeResponse.status, 200);
    const before = await beforeResponse.json() as any;
    assert.equal(before.is_anonymous, true);
    assert.equal(before.username, null);
    assert.equal(before.cloud_requests_remaining, 21);

    const email = 'anonymous-upgrade@example.com';
    const start = await worker.fetch(
      jsonRequest('/account/identities/email/start', { email }, {
        authorization: `Bearer ${anonymous.access_token}`,
      }),
      env,
    );
    assert.equal(start.status, 200);
    const verify = await worker.fetch(
      jsonRequest('/account/identities/email/verify', { email, code: sentCode }, {
        authorization: `Bearer ${anonymous.access_token}`,
      }),
      env,
    );
    assert.equal(verify.status, 200);
    const upgraded = (await verify.json() as any).account;
    assert.equal(upgraded.user_id, before.user_id);
    assert.equal(upgraded.is_anonymous, false);
    assert.equal(upgraded.username, null);
    assert.equal(upgraded.cloud_requests_remaining, 21);
  });

  it('keeps the user id and used quota when an anonymous session that already spent 1 request converts, logs out and reconnects', async () => {
    const anonymousResponse = await worker.fetch(
      jsonRequest('/auth/anonymous', {}),
      env,
    );
    assert.equal(anonymousResponse.status, 200);
    const anonymous = await anonymousResponse.json() as any;

    const beforeResponse = await worker.fetch(new Request('https://proxy.test/account', {
      headers: { authorization: `Bearer ${anonymous.access_token}` },
    }), env);
    const before = await beforeResponse.json() as any;
    assert.equal(before.is_anonymous, true);
    assert.equal(before.cloud_requests_remaining, 21);

    // Spend exactly 1 free request the same way a real chat completion does:
    // reserve then confirm, before any conversion happens.
    const reservation = await reserveFreeRequest(env, before.user_id, 'request-anon-spend-000001');
    assert.equal(reservation.remaining, 20);
    await confirmFreeRequest(env, reservation.ledgerId);

    const afterSpendResponse = await worker.fetch(new Request('https://proxy.test/account', {
      headers: { authorization: `Bearer ${anonymous.access_token}` },
    }), env);
    const afterSpend = await afterSpendResponse.json() as any;
    assert.equal(afterSpend.cloud_requests_remaining, 20);

    const email = 'anonymous-spent-upgrade@example.com';
    const start = await worker.fetch(
      jsonRequest('/account/identities/email/start', { email }, {
        authorization: `Bearer ${anonymous.access_token}`,
      }),
      env,
    );
    assert.equal(start.status, 200);
    const verify = await worker.fetch(
      jsonRequest('/account/identities/email/verify', { email, code: sentCode }, {
        authorization: `Bearer ${anonymous.access_token}`,
      }),
      env,
    );
    assert.equal(verify.status, 200);
    const verifyBody = await verify.json() as any;
    const upgraded = verifyBody.account;
    // The consumed request must not be wiped by conversion: same user_id, still 20 left.
    assert.equal(upgraded.user_id, before.user_id);
    assert.equal(upgraded.is_anonymous, false);
    assert.equal(upgraded.cloud_requests_remaining, 20);

    // Linking an identity to an already-authenticated session does not mint
    // new tokens (see verifyEmailLogin's linkUserId branch): the original
    // anonymous session token is still the live one to log out.
    assert.equal(verifyBody.access_token, undefined);
    const logoutResponse = await worker.fetch(new Request('https://proxy.test/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${anonymous.access_token}` },
    }), env);
    assert.equal(logoutResponse.status, 204);

    // The now-revoked access token must no longer work.
    const afterLogoutResponse = await worker.fetch(new Request('https://proxy.test/account', {
      headers: { authorization: `Bearer ${anonymous.access_token}` },
    }), env);
    assert.equal(afterLogoutResponse.status, 401);

    // Reconnecting (same email, new code) must return the same user_id and
    // the same remaining quota, not a fresh 21.
    const reconnectStart = await worker.fetch(
      jsonRequest('/auth/email/start', { email }),
      env,
    );
    assert.equal(reconnectStart.status, 200);
    const reconnectVerify = await worker.fetch(
      jsonRequest('/auth/email/verify', { email, code: sentCode }),
      env,
    );
    assert.equal(reconnectVerify.status, 200);
    const reconnected = (await reconnectVerify.json() as any).account;
    assert.equal(reconnected.user_id, before.user_id);
    assert.equal(reconnected.cloud_requests_remaining, 20);
  });

  it('returns the same user id when the same email signs in again', async () => {
    const first = await createAccount('same@example.com');
    // Signing in again is a sign-in, not a second creation: creating with an
    // already-linked email answers 409 by design. The address has no
    // password yet, so the code alone still opens it.
    const started = await worker.fetch(
      jsonRequest('/auth/email/start', { email: 'SAME@example.com' }),
      env,
    );
    assert.equal(started.status, 200);
    const verified = await worker.fetch(
      jsonRequest('/auth/email/verify', { email: 'SAME@example.com', code: sentCode }),
      env,
    );
    assert.equal(verified.status, 200);
    const second = await verified.json() as { account: { user_id: string; cloud_requests_remaining: number } };
    assert.equal(second.account.user_id, first.account.user_id);
    assert.equal(second.account.cloud_requests_remaining, 21);
  });

  it('refuses to sign in an email no account uses, and creates nothing', async () => {
    const before = await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
    const started = await worker.fetch(
      jsonRequest('/auth/email/start', { email: 'stranger@example.com' }),
      env,
    );
    assert.equal(started.status, 200);
    const verified = await worker.fetch(
      jsonRequest('/auth/email/verify', { email: 'stranger@example.com', code: sentCode }),
      env,
    );
    assert.equal(verified.status, 404);
    assert.equal(((await verified.json()) as any).error.code, 'account_not_found');
    const after = await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
    assert.equal(after?.count, before?.count);
  });

  it('demands the password once one exists, and lets the code reset it', async () => {
    const created = await createAccount('guarded@example.com');
    const set = await worker.fetch(
      jsonRequest('/account/password', {
        password: 'first-password-of-15-chars',
        prefix: 'guard',
        suffix: 'cheshire',
        username: 'guard.cheshire#2048',
      }, { authorization: `Bearer ${created.access_token}` }, 'PUT'),
      env,
    );
    assert.equal(set.status, 200);

    // A bare code is no longer a key to a passworded account.
    await worker.fetch(jsonRequest('/auth/email/start', { email: 'guarded@example.com' }), env);
    const bare = await worker.fetch(
      jsonRequest('/auth/email/verify', { email: 'guarded@example.com', code: sentCode }),
      env,
    );
    assert.equal(bare.status, 403);
    assert.equal(((await bare.json()) as any).error.code, 'password_required');

    // The same code with a new password is the reset, and it signs in.
    const reset = await worker.fetch(
      jsonRequest('/auth/email/verify', {
        email: 'guarded@example.com',
        code: sentCode,
        new_password: 'second-password-of-15plus',
      }),
      env,
    );
    assert.equal(reset.status, 200);

    // The old password died with the reset; the new one works.
    const oldLogin = await worker.fetch(
      jsonRequest('/auth/password/login', {
        identifier: 'guarded@example.com',
        password: 'first-password-of-15-chars',
      }),
      env,
    );
    assert.equal(oldLogin.status, 401);
    const newLogin = await worker.fetch(
      jsonRequest('/auth/password/login', {
        identifier: 'guarded@example.com',
        password: 'second-password-of-15plus',
      }),
      env,
    );
    assert.equal(newLogin.status, 200);
  });

  it('grants 21 requests only once per installation across different accounts', async () => {
    const first = await createAccount('grant-first@example.com');
    const second = await createAccount('grant-second@example.com');

    assert.equal(first.account.cloud_requests_remaining, 21);
    assert.equal(second.account.cloud_requests_remaining, 0);
    assert.notEqual(first.account.user_id, second.account.user_id);
    const grants = await db.prepare('SELECT COUNT(*) AS count FROM free_grants')
      .first<{ count: number }>();
    assert.equal(grants?.count, 1);
  });

  it('does not reset the grant when the IP address changes', async () => {
    const first = await createAccount('vpn-first@example.com', {
      'cf-connecting-ip': '203.0.113.8',
    });
    const second = await createAccount('vpn-second@example.com', {
      'cf-connecting-ip': '198.51.100.44',
    });

    assert.equal(first.account.cloud_requests_remaining, 21);
    assert.equal(second.account.cloud_requests_remaining, 0);
  });

  it('grants an independent installation its own allowance', async () => {
    const first = await createAccount('install-first@example.com', {
      'x-alice-install-id': 'install-independent-000000001',
    });
    const second = await createAccount('install-second@example.com', {
      'x-alice-install-id': 'install-independent-000000002',
    });

    assert.equal(first.account.cloud_requests_remaining, 21);
    assert.equal(second.account.cloud_requests_remaining, 21);
  });

  it('never gives one user more than one grant across installations', async () => {
    const first = await createAccount('one-user@example.com', {
      'x-alice-install-id': 'install-one-user-00000000001',
    });
    // A second device signs in; it does not create the account a second time.
    const secondInstall = { 'x-alice-install-id': 'install-one-user-00000000002' };
    await worker.fetch(jsonRequest('/auth/email/start', { email: 'one-user@example.com' }, secondInstall), env);
    const verified = await worker.fetch(
      jsonRequest('/auth/email/verify', { email: 'one-user@example.com', code: sentCode }, secondInstall),
      env,
    );
    assert.equal(verified.status, 200);
    const second = await verified.json() as { account: { user_id: string; cloud_requests_remaining: number } };

    assert.equal(second.account.user_id, first.account.user_id);
    assert.equal(second.account.cloud_requests_remaining, 21);
    const grants = await db.prepare(
      'SELECT COUNT(*) AS count FROM free_grants WHERE user_id = ?',
    ).bind(first.account.user_id).first<{ count: number }>();
    assert.equal(grants?.count, 1);
  });

  it('does not grant free requests without an installation identifier', async () => {
    // The account has to exist before it can sign in from anywhere.
    await createAccount('no-install@example.com', { 'x-alice-install-id': 'no-install-bootstrap-0001' });
    const start = await worker.fetch(new Request('https://proxy.test/auth/email/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.9',
      },
      body: JSON.stringify({ email: 'no-install@example.com' }),
    }), env);
    assert.equal(start.status, 200);
    const verified = await worker.fetch(new Request('https://proxy.test/auth/email/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.9',
      },
      body: JSON.stringify({ email: 'no-install@example.com', code: sentCode }),
    }), env);
    assert.equal(verified.status, 200);
    // Whatever the account already holds, a sign-in that names no
    // installation must not add a fresh grant on top.
    const grants = await db.prepare('SELECT COUNT(*) AS count FROM free_grants')
      .first<{ count: number }>();
    assert.equal(grants?.count, 1);
  });

  it('rejects a wrong or replayed code', async () => {
    await createAccount('code@example.com');
    await worker.fetch(jsonRequest('/auth/email/start', { email: 'code@example.com' }), env);
    const code = sentCode;
    const wrong = await worker.fetch(
      jsonRequest('/auth/email/verify', { email: 'code@example.com', code: '000000' }),
      env,
    );
    assert.equal(wrong.status, 400);

    const valid = await worker.fetch(
      jsonRequest('/auth/email/verify', { email: 'code@example.com', code }),
      env,
    );
    assert.equal(valid.status, 200);
    const replay = await worker.fetch(
      jsonRequest('/auth/email/verify', { email: 'code@example.com', code }),
      env,
    );
    assert.equal(replay.status, 400);
  });

  it('enforces the 60-second resend delay for an active code', async () => {
    const first = await worker.fetch(
      jsonRequest('/auth/email/start', { email: 'resend@example.com' }),
      env,
    );
    assert.equal(first.status, 200);
    const second = await worker.fetch(
      jsonRequest('/auth/email/start', { email: 'resend@example.com' }),
      env,
    );
    assert.equal(second.status, 429);
    assert.equal((await second.json() as any).error.code, 'email_resend_too_soon');
  });

  it('rejects an expired code', async () => {
    await worker.fetch(jsonRequest('/auth/email/start', { email: 'expired@example.com' }), env);
    await db.prepare(`
      UPDATE email_challenges SET expires_at = ?
    `).bind(Date.now() - 1).run();
    const expired = await worker.fetch(
      jsonRequest('/auth/email/verify', { email: 'expired@example.com', code: sentCode }),
      env,
    );
    assert.equal(expired.status, 400);
    assert.equal((await expired.json() as any).error.code, 'invalid_code');
  });

  it('limits new free accounts per daily IP bucket without blocking an existing account', async () => {
    const accounts = [];
    for (let index = 0; index < 5; index += 1) {
      accounts.push(await createAccount(`daily-${index}@example.com`));
    }
    // The sixth creation from the same IP dies where creation now happens:
    // at the moment the anonymous user would take its first identity.
    const anon6 = await worker.fetch(jsonRequest('/auth/anonymous', {}), env);
    assert.equal(anon6.status, 200);
    const sixthSession = await anon6.json() as { access_token: string };
    const authed6 = { authorization: `Bearer ${sixthSession.access_token}` };
    await worker.fetch(
      jsonRequest('/account/identities/email/start', { email: 'daily-6@example.com' }, authed6),
      env,
    );
    const sixth = await worker.fetch(
      jsonRequest('/account/identities/email/verify', {
        email: 'daily-6@example.com',
        code: sentCode,
      }, authed6),
      env,
    );
    assert.equal(sixth.status, 429);
    assert.equal((await sixth.json() as any).error.code, 'rate_limited');

    const existing = accounts[0];
    await db.prepare(`
      UPDATE email_challenges
      SET updated_at = ?, consumed_at = NULL
    `).bind(Date.now() - 61_000).run();
    const started = await worker.fetch(
      jsonRequest('/auth/email/start', { email: 'daily-0@example.com' }),
      env,
    );
    assert.equal(started.status, 200);
    const signedInAgain = await worker.fetch(
      jsonRequest('/auth/email/verify', {
        email: 'daily-0@example.com',
        code: sentCode,
      }),
      env,
    );
    assert.equal(signedInAgain.status, 200);
    assert.equal(
      (await signedInAgain.json() as any).account.user_id,
      existing.account.user_id,
    );
  });

  it('rotates a refresh token and rejects its replay', async () => {
    const account = await createAccount('refresh@example.com');
    const firstRefresh = await worker.fetch(
      jsonRequest('/auth/refresh', { refresh_token: account.refresh_token }),
      env,
    );
    assert.equal(firstRefresh.status, 200);
    const rotated = await firstRefresh.json() as any;
    assert.notEqual(rotated.refresh_token, account.refresh_token);

    const replay = await worker.fetch(
      jsonRequest('/auth/refresh', { refresh_token: account.refresh_token }),
      env,
    );
    assert.equal(replay.status, 401);
  });
});

describe('username and password account', () => {
  it('hands out the parts before a name exists', async () => {
    // The picker opens before anyone has typed. If the words and the number
    // only arrived with a name, the dropdown would sit dead and the number
    // would show dots, which is how it shipped broken once.
    const response = await worker.fetch(
      new Request('https://proxy.test/auth/username/vocabulary', {
        headers: { 'cf-connecting-ip': '203.0.113.8' },
      }),
      env,
    );
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.ok(result.suffixes.length >= 10, 'expected the whole vocabulary');
    assert.match(result.discriminator, /^[0-9]{4}$/);
  });

  it('returns every middle word once, in a stable order, when asked for all', async () => {
    // The picker shows the middle word as a list to scroll, so it needs the
    // whole vocabulary with one set of digits each, and in an order that does
    // not reshuffle underneath the person reading it.
    const response = await worker.fetch(
      jsonRequest('/auth/username/suggestions', { prefix: 'Satoshi', all: true }),
      env,
    );
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.ok(result.suggestions.length >= 10, 'expected the full suffix list');
    const suffixes = result.suggestions.map((item: any) => item.suffix);
    assert.equal(new Set(suffixes).size, suffixes.length, 'no suffix twice');
    // One number for the whole list. The digits are decided before the middle
    // word is chosen, and a number that changed with the choice would look
    // like part of the choice.
    const digits = result.suggestions.map((item: any) => item.username.split('#')[1]);
    assert.equal(new Set(digits).size, 1, `expected one shared number, got ${digits}`);
    // Stable: two calls agree on the order, whatever digits they carry.
    const again = await worker.fetch(
      jsonRequest('/auth/username/suggestions', { prefix: 'Satoshi', all: true }),
      env,
    );
    assert.deepEqual(
      ((await again.json()) as any).suggestions.map((item: any) => item.suffix),
      suffixes,
    );
  });

  it('offers 5 distinct Alice-style usernames with server-chosen discriminants', async () => {
    const response = await worker.fetch(
      jsonRequest('/auth/username/suggestions', {
        prefix: 'Sátoshi',
        display_name: 'Satoshi',
      }),
      env,
    );
    assert.equal(response.status, 200);
    const result = await response.json() as any;
    assert.equal(result.display_name, 'Satoshi');
    assert.equal(result.suggestions.length, 5);
    assert.equal(new Set(result.suggestions.map((item: any) => item.suffix)).size, 5);
    for (const suggestion of result.suggestions) {
      assert.match(suggestion.username, /^satoshi\.[a-z0-9-]+#[0-9]{4}$/);
    }
  });

  it('takes a username and a password, and reopens with the username', async () => {
    const { response } = await createNamedAccount({
      email: 'satoshi@example.com',
      prefix: 'Satoshi',
      suffix: 'cheshire',
      username: 'satoshi.cheshire#2048',
      display_name: 'Satoshi',
      password: 'correct horse battery staple',
    });
    assert.equal(response.status, 200);
    const created = await response.json() as any;
    assert.equal(created.account.username, 'satoshi.cheshire#2048');
    assert.equal(created.account.display_name, 'Satoshi');
    assert.equal(created.account.has_password, true);
    assert.equal(created.account.cloud_requests_remaining, 21);

    const loginResponse = await worker.fetch(
      jsonRequest('/auth/password/login', {
        identifier: created.account.username,
        password: 'correct horse battery staple',
      }, { 'x-alice-install-id': 'password-login-install-000001' }),
      env,
    );
    assert.equal(loginResponse.status, 200);
    assert.equal(
      (await loginResponse.json() as any).account.user_id,
      created.account.user_id,
    );
  });

  it('rejects selected digits that do not match the chosen prefix and suffix', async () => {
    const { response } = await createNamedAccount({
      email: 'mismatch@example.com',
      prefix: 'Satoshi',
      suffix: 'cheshire',
      username: 'satoshi.hatter#2048',
      password: 'correct horse battery staple',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as any).error.code, 'invalid_username');
  });

  it('allows a recovered email account to set a password and use email or username', async () => {
    const created = await createAccount('password-email@example.com', {
      'x-alice-install-id': 'password-email-install-000001',
    });
    const updatedResponse = await worker.fetch(
      jsonRequest('/account/password', {
        password: 'a long and memorable password',
      }, { authorization: `Bearer ${created.access_token}` }, 'PUT'),
      env,
    );
    assert.equal(updatedResponse.status, 200);
    const updated = (await updatedResponse.json() as any).account;
    assert.equal(updated.has_password, true);

    for (const identifier of ['password-email@example.com', updated.username]) {
      const loginResponse = await worker.fetch(
        jsonRequest('/auth/password/login', {
          identifier,
          password: 'a long and memorable password',
        }, { 'x-alice-install-id': 'password-email-install-000001' }),
        env,
      );
      assert.equal(loginResponse.status, 200);
      assert.equal(
        (await loginResponse.json() as any).account.user_id,
        created.account.user_id,
      );
    }
  });

  it('returns the same generic error for an unknown username and a wrong password', async () => {
    const { response } = await createNamedAccount({
      email: 'generic-error@example.com',
      prefix: 'Marius',
      suffix: 'frabjous',
      password: 'another long memorable password',
      installId: 'generic-error-install-000001',
    });
    const created = await response.json() as any;
    const responses = [];
    for (const [identifier, password] of [
      [created.account.username, 'this password is incorrect'],
      ['unknown.dreamer#0001', 'this password is incorrect'],
    ]) {
      responses.push(await worker.fetch(
        jsonRequest('/auth/password/login', { identifier, password }),
        env,
      ));
    }
    assert.deepEqual(responses.map(response => response.status), [401, 401]);
    const errors = await Promise.all(responses.map(response => response.json() as any));
    assert.equal(errors[0].error.code, 'invalid_credentials');
    assert.deepEqual(errors[0].error, errors[1].error);
  });

  it('changes display name independently and rotates username with a new discriminator', async () => {
    const { response, access_token } = await createNamedAccount({
      email: 'profile-change@example.com',
      prefix: 'Profile',
      suffix: 'dreamer',
      display_name: 'Profile',
      password: 'profile password long enough',
      installId: 'profile-change-install-000001',
    });
    const created = await response.json() as any;
    const displayResponse = await worker.fetch(
      jsonRequest('/account/profile', {
        display_name: 'New Display',
      }, { authorization: `Bearer ${access_token}` }, 'PUT'),
      env,
    );
    assert.equal(displayResponse.status, 200);
    const displayUpdated = (await displayResponse.json() as any).account;
    assert.equal(displayUpdated.display_name, 'New Display');
    assert.equal(displayUpdated.username, created.account.username);

    const usernameResponse = await worker.fetch(
      jsonRequest('/account/profile', {
        display_name: 'New Display',
        prefix: 'Profile',
        suffix: 'goldenkey',
      }, { authorization: `Bearer ${access_token}` }, 'PUT'),
      env,
    );
    assert.equal(usernameResponse.status, 200);
    const usernameUpdated = (await usernameResponse.json() as any).account;
    assert.match(usernameUpdated.username, /^profile\.goldenkey#[0-9]{4}$/);
    assert.notEqual(usernameUpdated.username, created.account.username);

    const history = await db.prepare(`
      SELECT reserved_until FROM username_history WHERE username = ?
    `).bind(created.account.username).first<{ reserved_until: number }>();
    assert.ok(history && history.reserved_until > Date.now());
    const secondChange = await worker.fetch(
      jsonRequest('/account/profile', {
        prefix: 'Profile',
        suffix: 'cheshire',
      }, { authorization: `Bearer ${access_token}` }, 'PUT'),
      env,
    );
    assert.equal(secondChange.status, 429);
    assert.equal((await secondChange.json() as any).error.code, 'username_change_too_soon');
  });

  it('stores no wallet secret or wallet-derived field in account credential tables', async () => {
    const tables = ['users', 'password_credentials', 'user_identities'];
    for (const table of tables) {
      const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      const names = columns.results.map(column => column.name);
      assert.equal(names.some(name => /mnemonic|seed|wallet.*key|private.*wallet/i.test(name)), false);
    }
  });
});

describe('free cloud quota', () => {
  it('charges an idempotency key only once', async () => {
    // The honest retry: a request that never delivered, sent again with its
    // own id. It must not be charged a second time, and it must go through.
    const created = await createAccount('idempotent@example.com');
    const requestKey = 'request-idempotent-000001';
    const first = await reserveFreeRequest(env, created.account.user_id, requestKey);
    const second = await reserveFreeRequest(env, created.account.user_id, requestKey);
    assert.equal(first.remaining, 20);
    assert.equal(first.duplicate, false);
    assert.equal(second.remaining, 20);
    assert.equal(second.duplicate, true);
  });

  it('refuses a request id whose answer was already delivered', async () => {
    // The dishonest replay, and the reason this test exists. The counters
    // stood still on a duplicate, which is right, and the caller went upstream
    // anyway, which was not: one id sent forever bought an unlimited number of
    // Venice calls on a twenty-one request allowance. Confirming the row is
    // what marks "this one was answered", so that is what a second call must
    // now hit.
    const created = await createAccount('replay@example.com');
    const requestKey = 'request-replay-0000001';
    const first = await reserveFreeRequest(env, created.account.user_id, requestKey);
    await confirmFreeRequest(env, first.ledgerId);

    await assert.rejects(
      () => reserveFreeRequest(env, created.account.user_id, requestKey),
      (error: any) => error.code === 'request_id_replayed' && error.status === 409,
    );

    // And the refusal costs the account nothing: one request spent, not two.
    const snapshot = await getAccountSnapshot(env, created.account.user_id);
    assert.equal(snapshot.cloud_requests_used, 1);
  });

  it('allows 21 confirmed requests and refuses the 22nd', async () => {
    const created = await createAccount('quota@example.com');
    for (let index = 0; index < 21; index += 1) {
      const reservation = await reserveFreeRequest(
        env,
        created.account.user_id,
        `request-quota-${String(index).padStart(8, '0')}`,
      );
      await confirmFreeRequest(env, reservation.ledgerId);
      assert.equal(reservation.remaining, 20 - index);
    }

    await assert.rejects(
      reserveFreeRequest(env, created.account.user_id, 'request-quota-00000022'),
      (error: unknown) => error instanceof AccountHttpError
        && error.code === 'free_quota_exhausted',
    );
    const snapshot = await getAccountSnapshot(env, created.account.user_id);
    assert.equal(snapshot.cloud_requests_used, 21);
    assert.equal(snapshot.cloud_requests_remaining, 0);
  });

  it('accepts only one concurrent reservation for the last remaining unit', async () => {
    const created = await createAccount('concurrency@example.com');
    await db.prepare(`
      UPDATE usage_counters
      SET free_cloud_requests_used = 20
      WHERE user_id = ?
    `).bind(created.account.user_id).run();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) => reserveFreeRequest(
        env,
        created.account.user_id,
        `request-concurrent-${String(index).padStart(8, '0')}`,
      )),
    );
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 9);
    const snapshot = await getAccountSnapshot(env, created.account.user_id);
    assert.equal(snapshot.cloud_requests_used, 21);
  });

  it('refunds a reservation that fails before inference', async () => {
    const created = await createAccount('refund@example.com');
    const reservation = await reserveFreeRequest(
      env,
      created.account.user_id,
      'request-refund-000000001',
    );
    assert.equal(reservation.remaining, 20);
    await refundFreeRequest(env, reservation.ledgerId, 'upstream_network_error');
    const snapshot = await getAccountSnapshot(env, created.account.user_id);
    assert.equal(snapshot.cloud_requests_used, 0);
    assert.equal(snapshot.cloud_requests_remaining, 21);
  });
});

describe('account data retention', () => {
  it('removes expired temporary records and old revoked sessions', async () => {
    const now = Date.now();
    const created = await createAccount('retention@example.com');
    await db.batch([
      db.prepare(`
        INSERT OR REPLACE INTO email_challenges (
          email_lookup, code_hash, expires_at, attempt_count,
          consumed_at, created_at, updated_at
        ) VALUES ('expired-email', 'expired-code', ?, 0, NULL, ?, ?)
      `).bind(now - 1, now - 60_000, now - 60_000),
      db.prepare(`
        INSERT OR REPLACE INTO auth_rate_limits (
          bucket, action, window_start, request_count, expires_at
        ) VALUES ('expired-bucket', 'test', ?, 1, ?)
      `).bind(now - 60_000, now - 1),
      db.prepare(`
        UPDATE sessions
        SET revoked_at = ?, refresh_expires_at = ?
        WHERE user_id = ?
      `).bind(
        now - 31 * 24 * 60 * 60 * 1_000,
        now + 24 * 60 * 60 * 1_000,
        created.account.user_id,
      ),
    ]);

    await cleanupExpiredAccountData(env, now);

    assert.equal(
      await db.prepare(`
        SELECT COUNT(*) AS count FROM email_challenges
        WHERE email_lookup = 'expired-email'
      `).first<{ count: number }>().then(row => row?.count),
      0,
    );
    assert.equal(
      await db.prepare(`
        SELECT COUNT(*) AS count FROM auth_rate_limits
        WHERE bucket = 'expired-bucket'
      `).first<{ count: number }>().then(row => row?.count),
      0,
    );
    assert.equal(
      await db.prepare(`
        SELECT COUNT(*) AS count FROM sessions
        WHERE user_id = ?
      `).bind(created.account.user_id).first<{ count: number }>().then(row => row?.count),
      0,
    );
  });
});
