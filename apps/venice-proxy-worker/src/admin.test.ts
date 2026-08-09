import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Miniflare } from 'miniflare';
import worker, { type Env } from './index.ts';

let miniflare: Miniflare;
let db: D1Database;
let env: Env;

const AUTH_SECRET = 'alice-test-hmac-secret-with-more-than-thirty-two-bytes';
const BOOTSTRAP_SECRET = 'alice-test-bootstrap-secret-with-more-than-32-bytes';
const INSTALL_ID = 'install-test-00000000000001';
const ADMIN_PASSWORD = 'a-very-strong-and-long-password-1';

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
  env = {
    ACCOUNT_DB: db,
    AUTH_HMAC_KEY: AUTH_SECRET,
    ADMIN_BOOTSTRAP_SECRET: BOOTSTRAP_SECRET,
    // The console is off by default in production; these tests exercise it,
    // so they switch it on explicitly.
    ADMIN_CONSOLE_ENABLED: 'true',
    VENICE_API_KEY: 'venice-test',
    ALLOWED_ORIGINS: 'https://alice.example',
    FREE_CLOUD_MODELS: 'e2ee-gpt-oss-120b-p',
    FREE_CLOUD_MAX_TOKENS: '2048',
  } as unknown as Env;
});

afterEach(async () => {
  await miniflare.dispose();
});

function enc(value: string): string {
  return encodeURIComponent(value);
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  return new Request(`https://proxy.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.8',
      'x-alice-install-id': INSTALL_ID,
      ...headers,
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

async function registerAccount(prefix: string) {
  // A distinct install id per account: the free 21-request grant is claimed
  // once per installation, so sharing one id across accounts in a test would
  // silently starve every account after the first.
  const res = await worker.fetch(
    jsonRequest('/auth/password/register', {
      password: ADMIN_PASSWORD,
      prefix,
      suffix: 'wonderland',
    }, { 'x-alice-install-id': `install-${prefix}-000000000000` }),
    env,
  );
  assert.equal(res.status, 200);
  return res.json() as Promise<{
    access_token: string;
    account: { user_id: string; username: string };
  }>;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('admin bootstrap', () => {
  it('lets the first authenticated account self-promote with the secret', async () => {
    const account = await registerAccount('bootstrap-one');
    const res = await worker.fetch(
      jsonRequest('/admin/api/bootstrap', {}, {
        ...bearer(account.access_token),
        'x-admin-bootstrap-secret': BOOTSTRAP_SECRET,
      }),
      env,
    );
    assert.equal(res.status, 200);

    const session = await worker.fetch(
      jsonRequest('/admin/api/session', {}, bearer(account.access_token), 'GET'),
      env,
    );
    assert.equal(session.status, 200);
  });

  it('rejects a wrong secret', async () => {
    const account = await registerAccount('bootstrap-two');
    const res = await worker.fetch(
      jsonRequest('/admin/api/bootstrap', {}, {
        ...bearer(account.access_token),
        'x-admin-bootstrap-secret': 'wrong-secret-wrong-secret-wrong-secret',
      }),
      env,
    );
    assert.equal(res.status, 403);
  });

  it('refuses to bootstrap a second admin once one exists', async () => {
    const first = await registerAccount('bootstrap-three');
    await worker.fetch(
      jsonRequest('/admin/api/bootstrap', {}, {
        ...bearer(first.access_token),
        'x-admin-bootstrap-secret': BOOTSTRAP_SECRET,
      }),
      env,
    );
    const second = await registerAccount('bootstrap-four');
    const res = await worker.fetch(
      jsonRequest('/admin/api/bootstrap', {}, {
        ...bearer(second.access_token),
        'x-admin-bootstrap-secret': BOOTSTRAP_SECRET,
      }),
      env,
    );
    assert.equal(res.status, 409);
  });
});

async function bootstrapAdmin(prefix: string) {
  const account = await registerAccount(prefix);
  // Follow wherever the dashboard is configured to live, so these helpers
  // keep working when a secret path is set.
  const base = (env as { ADMIN_DASHBOARD_PATH?: string }).ADMIN_DASHBOARD_PATH || '/admin';
  const res = await worker.fetch(
    jsonRequest(`${base}/api/bootstrap`, {}, {
      ...bearer(account.access_token),
      'x-admin-bootstrap-secret': BOOTSTRAP_SECRET,
    }),
    env,
  );
  assert.equal(res.status, 200);
  return account;
}

describe('admin access control', () => {
  it('rejects a non-admin session', async () => {
    const account = await registerAccount('non-admin');
    const res = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(account.access_token), 'GET'),
      env,
    );
    assert.equal(res.status, 403);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/admin/api/overview'), env);
    assert.equal(res.status, 401);
  });

  it('serves the static dashboard shell without auth', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/admin'), env);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  });
});

describe('admin overview', () => {
  it('counts accounts, installs and quota consumption', async () => {
    const admin = await bootstrapAdmin('overview-admin');
    await registerAccount('overview-user');
    await worker.fetch(
      jsonRequest('/auth/anonymous', {}, {}, 'POST'),
      env,
    );

    const res = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(res.status, 200);
    const body = await res.json() as {
      accounts_created: number;
      installations_anonymous: number;
    };
    assert.equal(body.accounts_created, 2);
    assert.equal(body.installations_anonymous, 1);
  });
});

describe('admin account operations', () => {
  it('finds, suspends, and reactivates an account, writing an audit trail', async () => {
    const admin = await bootstrapAdmin('ops-admin');
    const target = await registerAccount('ops-target');

    const list = await worker.fetch(
      jsonRequest(`/admin/api/accounts?q=${target.account.username.split('.')[0]}`, {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(list.status, 200);
    const listBody = await list.json() as { accounts: { support_id: string }[] };
    assert.ok(listBody.accounts.some(a => a.support_id === target.account.username));

    const suspend = await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(target.account.username)}/suspend`, { reason: 'abuse report' }, bearer(admin.access_token)),
      env,
    );
    assert.equal(suspend.status, 200);

    // A suspended account can no longer authenticate.
    const blockedLogin = await worker.fetch(
      jsonRequest('/auth/password/login', {
        identifier: target.account.username,
        password: ADMIN_PASSWORD,
      }),
      env,
    );
    assert.equal(blockedLogin.status, 401);

    const reactivate = await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(target.account.username)}/reactivate`, { reason: 'resolved' }, bearer(admin.access_token)),
      env,
    );
    assert.equal(reactivate.status, 200);

    const audit = await worker.fetch(
      jsonRequest('/admin/api/audit-log', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    const auditBody = await audit.json() as { entries: { action: string }[] };
    const actions = auditBody.entries.map(entry => entry.action);
    assert.ok(actions.includes('suspend_account'));
    assert.ok(actions.includes('reactivate_account'));
    assert.ok(actions.includes('admin_bootstrap'));
  });

  it('requires a reason to suspend', async () => {
    const admin = await bootstrapAdmin('reason-admin');
    const target = await registerAccount('reason-target');
    const res = await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(target.account.username)}/suspend`, {}, bearer(admin.access_token)),
      env,
    );
    assert.equal(res.status, 400);
  });

  it('adjusts free-request credits and clamps at what is already used', async () => {
    const admin = await bootstrapAdmin('credit-admin');
    const target = await registerAccount('credit-target');

    const grant = await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(target.account.username)}/credits`, { delta: 10, reason: 'support gesture' }, bearer(admin.access_token)),
      env,
    );
    assert.equal(grant.status, 200);
    const grantBody = await grant.json() as { cloud_requests_limit: number };
    assert.equal(grantBody.cloud_requests_limit, 31);

    const revoke = await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(target.account.username)}/credits`, { delta: -1000, reason: 'correction' }, bearer(admin.access_token)),
      env,
    );
    assert.equal(revoke.status, 200);
    const revokeBody = await revoke.json() as { cloud_requests_limit: number };
    // Cannot drop the limit below what has already been used (0 here).
    assert.equal(revokeBody.cloud_requests_limit, 0);
  });

  it('never exposes password hashes, secrets, or the account key in account detail', async () => {
    const admin = await bootstrapAdmin('privacy-admin');
    const target = await registerAccount('privacy-target');
    const res = await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(target.account.username)}`, {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.doesNotMatch(text, /password_hash/i);
    assert.doesNotMatch(text, /salt/i);
    assert.doesNotMatch(text, /access_token/i);
    assert.doesNotMatch(text, /refresh_token/i);
  });

  it('permanently deletes an account only with the exact support id typed as confirmation', async () => {
    const admin = await bootstrapAdmin('delete-admin');
    const target = await registerAccount('delete-target');

    const badConfirm = await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(target.account.username)}`, { confirm: 'not-the-right-id', admin_password: ADMIN_PASSWORD }, bearer(admin.access_token), 'DELETE'),
      env,
    );
    assert.equal(badConfirm.status, 400);

    const goodConfirm = await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(target.account.username)}`, { confirm: target.account.username, admin_password: ADMIN_PASSWORD }, bearer(admin.access_token), 'DELETE'),
      env,
    );
    assert.equal(goodConfirm.status, 200);

    const gone = await worker.fetch(
      jsonRequest('/auth/password/login', {
        identifier: target.account.username,
        password: ADMIN_PASSWORD,
      }),
      env,
    );
    assert.equal(gone.status, 401);

    const row = await db.prepare('SELECT id FROM users WHERE username = ?').bind(target.account.username).first();
    assert.equal(row, null);
  });
});

describe('admin/admins management', () => {
  it('promotes and demotes admins, refusing to remove the last one', async () => {
    const first = await bootstrapAdmin('lastadmin-one');
    const second = await registerAccount('lastadmin-two');

    const promote = await worker.fetch(
      jsonRequest('/admin/api/admins', { account: second.account.username, admin_password: ADMIN_PASSWORD }, bearer(first.access_token)),
      env,
    );
    assert.equal(promote.status, 200);

    const demoteFirst = await worker.fetch(
      jsonRequest(`/admin/api/admins/${enc(first.account.username)}`, { admin_password: ADMIN_PASSWORD }, bearer(second.access_token), 'DELETE'),
      env,
    );
    assert.equal(demoteFirst.status, 200);

    // Now only `second` remains an admin; removing them must fail.
    const demoteLast = await worker.fetch(
      jsonRequest(`/admin/api/admins/${enc(second.account.username)}`, { admin_password: ADMIN_PASSWORD }, bearer(second.access_token), 'DELETE'),
      env,
    );
    assert.equal(demoteLast.status, 409);
  });
});

describe('promo codes', () => {
  it('creates a code and lets a user redeem it exactly once', async () => {
    const admin = await bootstrapAdmin('promo-admin');
    const user = await registerAccount('promo-user');

    const create = await worker.fetch(
      jsonRequest('/admin/api/promo-codes', { code: 'ALICE-TEST', credits: 5, max_redemptions: 5 }, bearer(admin.access_token)),
      env,
    );
    assert.equal(create.status, 200);

    const redeem = await worker.fetch(
      jsonRequest('/account/promo/redeem', { code: 'alice-test' }, bearer(user.access_token)),
      env,
    );
    assert.equal(redeem.status, 200);
    const redeemBody = await redeem.json() as { account: { cloud_requests_limit: number } };
    assert.equal(redeemBody.account.cloud_requests_limit, 26);

    const again = await worker.fetch(
      jsonRequest('/account/promo/redeem', { code: 'alice-test' }, bearer(user.access_token)),
      env,
    );
    assert.equal(again.status, 409);
  });

  it('refuses a disabled code', async () => {
    const admin = await bootstrapAdmin('promo-admin-2');
    const user = await registerAccount('promo-user-2');
    await worker.fetch(
      jsonRequest('/admin/api/promo-codes', { code: 'ALICE-DIS', credits: 5, max_redemptions: 5 }, bearer(admin.access_token)),
      env,
    );
    await worker.fetch(
      jsonRequest('/admin/api/promo-codes/ALICE-DIS/disable', {}, bearer(admin.access_token)),
      env,
    );
    const redeem = await worker.fetch(
      jsonRequest('/account/promo/redeem', { code: 'ALICE-DIS' }, bearer(user.access_token)),
      env,
    );
    assert.equal(redeem.status, 400);
  });
});

describe('admin hardening', () => {
  it('refuses destructive actions without password re-authentication', async () => {
    const admin = await bootstrapAdmin('reauth-admin');
    const target = await registerAccount('reauth-target');

    const noPassword = await worker.fetch(
      jsonRequest(
        `/admin/api/accounts/${enc(target.account.username)}`,
        { confirm: target.account.username },
        bearer(admin.access_token),
        'DELETE',
      ),
      env,
    );
    assert.equal(noPassword.status, 403);

    const wrongPassword = await worker.fetch(
      jsonRequest(
        `/admin/api/accounts/${enc(target.account.username)}`,
        { confirm: target.account.username, admin_password: 'not-the-admin-password-at-all' },
        bearer(admin.access_token),
        'DELETE',
      ),
      env,
    );
    assert.equal(wrongPassword.status, 403);

    // The account is untouched after both refusals.
    const still = await db.prepare('SELECT id FROM users WHERE username = ?')
      .bind(target.account.username).first();
    assert.ok(still);
  });

  it('gives a support operator read access but refuses every mutation', async () => {
    const admin = await bootstrapAdmin('rbac-admin');
    const supporter = await registerAccount('rbac-support');
    const target = await registerAccount('rbac-target');

    const promote = await worker.fetch(
      jsonRequest(
        '/admin/api/admins',
        { account: supporter.account.username, role: 'support', admin_password: ADMIN_PASSWORD },
        bearer(admin.access_token),
      ),
      env,
    );
    assert.equal(promote.status, 200);

    // Reads are allowed.
    for (const path of ['/admin/api/overview', '/admin/api/analytics', '/admin/api/accounts']) {
      const res = await worker.fetch(
        jsonRequest(path, {}, bearer(supporter.access_token), 'GET'),
        env,
      );
      assert.equal(res.status, 200, `${path} should be readable by support`);
    }

    // Mutations are not.
    const suspend = await worker.fetch(
      jsonRequest(
        `/admin/api/accounts/${enc(target.account.username)}/suspend`,
        { reason: 'nope' },
        bearer(supporter.access_token),
      ),
      env,
    );
    assert.equal(suspend.status, 403);
    const body = await suspend.json() as { error: { code: string } };
    assert.equal(body.error.code, 'admin_role_required');

    const credits = await worker.fetch(
      jsonRequest(
        `/admin/api/accounts/${enc(target.account.username)}/credits`,
        { delta: 5, reason: 'nope' },
        bearer(supporter.access_token),
      ),
      env,
    );
    assert.equal(credits.status, 403);
  });

  it('records denied attempts so probing is visible', async () => {
    const admin = await bootstrapAdmin('denial-admin');
    const outsider = await registerAccount('denial-outsider');

    await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(outsider.access_token), 'GET'),
      env,
    );
    const res = await worker.fetch(
      jsonRequest('/admin/api/access-denials', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(res.status, 200);
    const body = await res.json() as { denials: { reason: string; support_id: string }[] };
    assert.ok(body.denials.some(d => d.reason === 'not_admin'
      && d.support_id === outsider.account.username));
  });
});

describe('analytics', () => {
  it('reports retention, funnel and quota histogram as aggregates only', async () => {
    const admin = await bootstrapAdmin('analytics-admin');
    await registerAccount('analytics-user');

    const res = await worker.fetch(
      jsonRequest('/admin/api/analytics', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(res.status, 200);
    const body = await res.json() as {
      retention: { d1: { eligible: number }; d7: unknown; d30: unknown };
      funnel: { installs: number; created_account: number };
      quota_histogram: { used_none: number };
      platforms: { platform: string; count: number }[];
    };
    assert.ok(body.retention.d1);
    assert.equal(body.funnel.installs, 2);
    // Both installs were tied to a real account at registration time.
    assert.equal(body.funnel.created_account, 2);
    assert.equal(body.quota_histogram.used_none, 2);

    // Nothing in the payload identifies an individual.
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /user_id/);
    assert.doesNotMatch(text, /install_id/);
  });

  it('records the platform and app version reported by a client', async () => {
    const admin = await bootstrapAdmin('platform-admin');
    await worker.fetch(
      jsonRequest('/auth/anonymous', {}, {
        'x-alice-install-id': 'install-platform-0000000001',
        'x-alice-platform': 'ios',
        'x-alice-app-version': '1.4.2',
      }),
      env,
    );
    const res = await worker.fetch(
      jsonRequest('/admin/api/analytics', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    const body = await res.json() as { platforms: { platform: string; app_version: string }[] };
    assert.ok(body.platforms.some(p => p.platform === 'ios' && p.app_version === '1.4.2'));
  });

  it('drops a platform or version that is not on the allowlist', async () => {
    const admin = await bootstrapAdmin('badplatform-admin');
    await worker.fetch(
      jsonRequest('/auth/anonymous', {}, {
        'x-alice-install-id': 'install-badplatform-000001',
        'x-alice-platform': 'definitely-not-a-real-platform',
        'x-alice-app-version': 'not-a-version',
      }),
      env,
    );
    const res = await worker.fetch(
      jsonRequest('/admin/api/analytics', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    const body = await res.json() as { platforms: { platform: string; app_version: string }[] };
    assert.ok(!body.platforms.some(p => p.platform.includes('definitely-not')));
    assert.ok(!body.platforms.some(p => p.app_version.includes('not-a-version')));
  });
});

describe('product events', () => {
  it('counts allowlisted events and silently drops everything else', async () => {
    const admin = await bootstrapAdmin('events-admin');
    const user = await registerAccount('events-user');

    const post = await worker.fetch(
      jsonRequest('/account/events', {
        events: [
          'app_opened',
          'app_opened',
          'download_completed',
          // Not on the allowlist: a client trying to smuggle content through.
          'search:how do I move my bitcoin',
          'wallet_created',
        ],
      }, { ...bearer(user.access_token), 'x-alice-platform': 'android', 'x-alice-app-version': '2.0.0' }),
      env,
    );
    assert.equal(post.status, 200);
    assert.deepEqual(await post.json(), { accepted: 2 });

    const res = await worker.fetch(
      jsonRequest('/admin/api/events', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    const body = await res.json() as {
      totals: { event_name: string; platform: string; count: number }[];
    };
    const opened = body.totals.find(t => t.event_name === 'app_opened');
    assert.equal(opened?.count, 2);
    assert.equal(opened?.platform, 'android');
    // The smuggled string never reached storage.
    const text = JSON.stringify(body.totals);
    assert.doesNotMatch(text, /how do I move my bitcoin/);
    assert.doesNotMatch(text, /wallet_created/);
  });

  it('stores no user or session identifier alongside an event', async () => {
    const user = await registerAccount('events-anon');
    await worker.fetch(
      jsonRequest('/account/events', { events: ['chat_opened'] }, bearer(user.access_token)),
      env,
    );
    const rows = await db.prepare('SELECT * FROM events_daily').all();
    assert.ok(rows.results.length > 0);
    for (const row of rows.results) {
      assert.deepEqual(
        Object.keys(row).sort(),
        ['app_version', 'count', 'day', 'event_name', 'platform'],
      );
    }
  });

  it('requires a session to submit events', async () => {
    const res = await worker.fetch(
      jsonRequest('/account/events', { events: ['app_opened'] }),
      env,
    );
    assert.equal(res.status, 401);
  });
});

describe('admin transport security', () => {
  it('never emits CORS headers on the admin API, even for an allowlisted origin', async () => {
    const admin = await bootstrapAdmin('cors-admin');
    const res = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, {
        ...bearer(admin.access_token),
        origin: 'https://alice.example',
      }, 'GET'),
      env,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('refuses a preflight for the admin API', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.test/admin/api/overview', {
        method: 'OPTIONS',
        headers: { origin: 'https://alice.example' },
      }),
      env,
    );
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });

  it('serves the dashboard unframable and unindexable', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/admin'), env);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });

  it('still emits CORS on the normal account API', async () => {
    const res = await worker.fetch(
      new Request('https://proxy.test/auth/anonymous', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://alice.example',
          'x-alice-install-id': 'install-cors-check-00000001',
        },
        body: '{}',
      }),
      env,
    );
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://alice.example');
  });
});

describe('admin allowlist gate', () => {
  it('refuses an admin row that is not on ADMIN_ALLOWED_USERNAMES', async () => {
    const admin = await bootstrapAdmin('allowlist-admin');

    // Without the env allowlist the database alone decides: access granted.
    const before = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(before.status, 200);

    // With an allowlist naming someone else, the same admin row is refused.
    env.ADMIN_ALLOWED_USERNAMES = 'someone.else#0001';
    const after = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(after.status, 403);

    // Naming the real admin restores access.
    env.ADMIN_ALLOWED_USERNAMES = `other#0002, ${admin.account.username}`;
    const restored = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(restored.status, 200);
  });
});

describe('bootstrap race', () => {
  it('gives admin to exactly one account when two bootstrap concurrently', async () => {
    const first = await registerAccount('race-one');
    const second = await registerAccount('race-two');

    const results = await Promise.all([
      worker.fetch(
        jsonRequest('/admin/api/bootstrap', {}, {
          ...bearer(first.access_token),
          'x-admin-bootstrap-secret': BOOTSTRAP_SECRET,
        }),
        env,
      ),
      worker.fetch(
        jsonRequest('/admin/api/bootstrap', {}, {
          ...bearer(second.access_token),
          'x-admin-bootstrap-secret': BOOTSTRAP_SECRET,
        }),
        env,
      ),
    ]);
    const succeeded = results.filter(r => r.status === 200).length;
    assert.equal(succeeded, 1, 'exactly one bootstrap must win');

    const count = await db.prepare('SELECT COUNT(*) AS count FROM admin_users')
      .first<{ count: number }>();
    assert.equal(count?.count, 1);
  });
});

describe('audit log hygiene', () => {
  it('does not flood the audit log when the dashboard reloads', async () => {
    const admin = await bootstrapAdmin('audit-flood-admin');
    for (let i = 0; i < 5; i += 1) {
      await worker.fetch(
        jsonRequest('/admin/api/session', {}, bearer(admin.access_token), 'GET'),
        env,
      );
    }
    const logins = await db.prepare(
      "SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'admin_login'",
    ).first<{ count: number }>();
    assert.equal(logins?.count, 1);
  });
});

describe('first-run bootstrap flow', () => {
  it('walks a brand-new operator from account creation to admin access', async () => {
    // 1. Create an Alice account with a password, exactly as the app does.
    const created = await worker.fetch(
      jsonRequest('/auth/password/register', {
        password: 'a-very-strong-and-long-password-1',
        prefix: 'marius',
        suffix: 'wonderland',
      }, { 'x-alice-install-id': 'install-firstrun-0000000001' }),
      env,
    );
    assert.equal(created.status, 200);
    const account = await created.json() as {
      account: { username: string };
    };
    assert.match(account.account.username, /^marius\.wonderland#\d{4}$/);

    // 2. Sign in from the dashboard's login form.
    const signIn = await worker.fetch(
      jsonRequest('/auth/password/login', {
        identifier: account.account.username,
        password: 'a-very-strong-and-long-password-1',
      }),
      env,
    );
    assert.equal(signIn.status, 200);
    const token = (await signIn.json() as { access_token: string }).access_token;

    // 3. The session is valid but not admin yet — this is what makes the
    //    dashboard reveal the bootstrap form rather than an error.
    const before = await worker.fetch(
      jsonRequest('/admin/api/session', {}, bearer(token), 'GET'),
      env,
    );
    assert.equal(before.status, 403);
    assert.equal(
      (await before.json() as { error: { code: string } }).error.code,
      'admin_required',
    );

    // 4. Claim admin with the bootstrap secret, from that same session.
    const claim = await worker.fetch(
      jsonRequest('/admin/api/bootstrap', {}, {
        ...bearer(token),
        'x-admin-bootstrap-secret': BOOTSTRAP_SECRET,
      }),
      env,
    );
    assert.equal(claim.status, 200);

    // 5. The same session is now a full admin.
    const after = await worker.fetch(
      jsonRequest('/admin/api/session', {}, bearer(token), 'GET'),
      env,
    );
    assert.equal(after.status, 200);
    const session = await after.json() as { role: string; username: string };
    assert.equal(session.role, 'admin');
    assert.equal(session.username, account.account.username);

    // 6. And can perform an admin-only action with a password re-auth.
    const target = await registerAccount('firstrun-target');
    const suspend = await worker.fetch(
      jsonRequest(
        `/admin/api/accounts/${enc(target.account.username)}/suspend`,
        { reason: 'checking the operator tools work' },
        bearer(token),
      ),
      env,
    );
    assert.equal(suspend.status, 200);
  });

  it('refuses a password shorter than Alice allows', async () => {
    const res = await worker.fetch(
      jsonRequest('/auth/password/register', {
        password: 'short-pass',
        prefix: 'tooshort',
        suffix: 'wonderland',
      }, { 'x-alice-install-id': 'install-shortpw-0000000001' }),
      env,
    );
    assert.equal(res.status, 400);
    assert.equal(
      (await res.json() as { error: { code: string } }).error.code,
      'invalid_password',
    );
  });
});

// Every route the dashboard can reach. Kept exhaustive on purpose: if a new
// admin endpoint is added without protection, this list is where it shows up.
const EVERY_ADMIN_ROUTE: [string, string][] = [
  ['GET', '/admin/api/session'],
  ['GET', '/admin/api/overview'],
  ['GET', '/admin/api/analytics'],
  ['GET', '/admin/api/events'],
  ['GET', '/admin/api/access-denials'],
  ['GET', '/admin/api/accounts'],
  ['GET', '/admin/api/accounts/someone.wonderland%230001'],
  ['POST', '/admin/api/accounts/someone.wonderland%230001/suspend'],
  ['POST', '/admin/api/accounts/someone.wonderland%230001/reactivate'],
  ['POST', '/admin/api/accounts/someone.wonderland%230001/credits'],
  ['DELETE', '/admin/api/accounts/someone.wonderland%230001'],
  ['GET', '/admin/api/admins'],
  ['POST', '/admin/api/admins'],
  ['DELETE', '/admin/api/admins/someone.wonderland%230001'],
  ['GET', '/admin/api/audit-log'],
  ['GET', '/admin/api/promo-codes'],
  ['POST', '/admin/api/promo-codes'],
  ['POST', '/admin/api/promo-codes/ALICE-X/disable'],
];

describe('the password is the real gate', () => {
  it('refuses every admin route to a forged bearer token', async () => {
    // Exactly the kind of value a tampered client would put in storage.
    const forged = 'mock-token-for-layout-verification-only-aaaaaaaaaaaa';
    for (const [method, path] of EVERY_ADMIN_ROUTE) {
      const res = await worker.fetch(
        jsonRequest(path, { reason: 'x', delta: 1, credits: 1, account: 'x' },
          bearer(forged), method),
        env,
      );
      assert.equal(res.status, 401, `${method} ${path} must reject a forged token`);
    }
  });

  it('refuses every admin route to no token at all', async () => {
    for (const [method, path] of EVERY_ADMIN_ROUTE) {
      const res = await worker.fetch(
        jsonRequest(path, { reason: 'x', delta: 1, credits: 1, account: 'x' }, {}, method),
        env,
      );
      assert.equal(res.status, 401, `${method} ${path} must reject an anonymous caller`);
    }
  });

  it('refuses every admin route to a real session that is not an admin', async () => {
    // A genuine, valid Alice account. The password was correct; the account
    // simply has no admin_users row.
    const ordinary = await registerAccount('outsider');
    for (const [method, path] of EVERY_ADMIN_ROUTE) {
      const res = await worker.fetch(
        jsonRequest(path, { reason: 'x', delta: 1, credits: 1, account: 'x' },
          bearer(ordinary.access_token), method),
        env,
      );
      assert.equal(res.status, 403, `${method} ${path} must reject a non-admin session`);
      const text = await res.text();
      assert.doesNotMatch(text, /accounts_created|support_id|audit|promo_codes/i,
        `${method} ${path} must leak no data to a non-admin`);
    }
  });

  it('cannot be unlocked by tampering with the page, because the page holds no data', async () => {
    // Put real, identifiable data in the database first...
    const admin = await bootstrapAdmin('leakcheck-admin');
    const target = await registerAccount('leakcheck-target');
    const session = await db.prepare(
      'SELECT access_token_hash FROM sessions LIMIT 1',
    ).first<{ access_token_hash: string }>();

    // ...then fetch the public shell with no credentials at all.
    const res = await worker.fetch(new Request('https://proxy.test/admin'), env);
    const html = await res.text();

    // The page ships the *names* of the fields it will render — that is the
    // renderer's code. It must ship none of the *values*. Tampering with the
    // page in devtools therefore reveals nothing: there is nothing there.
    for (const secret of [
      admin.account.username,
      target.account.username,
      admin.account.user_id,
      target.account.user_id,
      admin.access_token,
      session?.access_token_hash ?? 'no-session-hash',
    ]) {
      assert.equal(
        html.includes(secret), false,
        `/admin must not embed ${secret.slice(0, 12)}…`,
      );
    }
    // No credential material is templated in. Note the page does contain the
    // *name* ADMIN_BOOTSTRAP_SECRET, as the placeholder telling the operator
    // which variable to paste — naming an env var is not disclosing it.
    assert.equal(html.includes(BOOTSTRAP_SECRET), false, 'the secret value must never be templated in');
    assert.equal(html.includes(AUTH_SECRET), false, 'the HMAC key must never be templated in');
    assert.doesNotMatch(html, /password_hash|scrypt/);
  });

  it('still refuses once a suspended admin loses their account', async () => {
    const admin = await bootstrapAdmin('revoked-admin');
    const second = await registerAccount('second-admin');
    await worker.fetch(
      jsonRequest('/admin/api/admins',
        { account: second.account.username, admin_password: ADMIN_PASSWORD },
        bearer(admin.access_token)),
      env,
    );
    // Suspending the account revokes its sessions, so the admin row alone is
    // not enough to keep the dashboard open.
    await worker.fetch(
      jsonRequest(`/admin/api/accounts/${enc(admin.account.username)}/suspend`,
        { reason: 'compromised' }, bearer(second.access_token)),
      env,
    );
    const res = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(res.status, 401);
  });
});

describe('secret dashboard path', () => {
  const SECRET_PATH = '/console-7fq2xk';

  it('moves the whole dashboard and makes /admin disappear', async () => {
    env.ADMIN_DASHBOARD_PATH = SECRET_PATH;
    const admin = await bootstrapAdmin('secretpath-admin');

    // The default path no longer exists at all.
    const oldShell = await worker.fetch(new Request(`https://proxy.test/admin`), env);
    assert.equal(oldShell.status, 404);
    const oldApi = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(oldApi.status, 404);

    // The secret path serves the shell and the API.
    const shell = await worker.fetch(new Request(`https://proxy.test${SECRET_PATH}`), env);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(shell.headers.get('x-frame-options'), 'DENY');

    const api = await worker.fetch(
      jsonRequest(`${SECRET_PATH}/api/overview`, {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(api.status, 200);
  });

  it('still refuses a non-admin on the secret path', async () => {
    env.ADMIN_DASHBOARD_PATH = SECRET_PATH;
    await bootstrapAdmin('secretpath-owner');
    const outsider = await registerAccount('secretpath-outsider');
    const res = await worker.fetch(
      jsonRequest(`${SECRET_PATH}/api/overview`, {}, bearer(outsider.access_token), 'GET'),
      env,
    );
    // Knowing the URL buys nothing: the role check is unchanged.
    assert.equal(res.status, 403);
  });

  it('falls back to /admin rather than half-applying a malformed path', async () => {
    for (const bad of ['admin-no-slash', '/has/two/segments', '/spaces here', '/', '']) {
      env.ADMIN_DASHBOARD_PATH = bad;
      const res = await worker.fetch(new Request('https://proxy.test/admin'), env);
      assert.equal(res.status, 200, `${JSON.stringify(bad)} must fall back to /admin`);
    }
  });
});

describe('the admin username cannot be guessed by probing', () => {
  it('answers identically for an unknown account and a wrong password', async () => {
    const real = await registerAccount('enumeration-check');

    const wrongPassword = await worker.fetch(
      jsonRequest('/auth/password/login', {
        identifier: real.account.username,
        password: 'a-completely-different-password-x',
      }),
      env,
    );
    const noSuchAccount = await worker.fetch(
      jsonRequest('/auth/password/login', {
        identifier: 'nobody.wonderland#0000',
        password: 'a-completely-different-password-x',
      }),
      env,
    );

    // Same status and same body: nothing distinguishes "this username exists"
    // from "this password is wrong", so an attacker cannot enumerate.
    assert.equal(wrongPassword.status, 401);
    assert.equal(noSuchAccount.status, 401);
    assert.deepEqual(await wrongPassword.json(), await noSuchAccount.json());
  });

  it('rate-limits repeated password attempts against one identifier', async () => {
    const real = await registerAccount('bruteforce-check');
    let sawRateLimit = false;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const res = await worker.fetch(
        jsonRequest('/auth/password/login', {
          identifier: real.account.username,
          password: `guess-number-${attempt}-padded-out`,
        }),
        env,
      );
      if (res.status === 429) { sawRateLimit = true; break; }
    }
    assert.ok(sawRateLimit, 'repeated guesses against one identifier must be throttled');
  });
});

describe('the dashboard script is valid JavaScript', () => {
  it('parses and executes without a syntax error', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/admin'), env);
    const html = await res.text();
    const script = html.split('<script>')[1].split('</script>')[0];
    // A regression test for a real incident: a single backslash inside the
    // outer TS template literal collapsed away during compilation, turning
    // `/\/+$/` into `//+$/` (a JS line comment) and `/^\/admin\/api/` into
    // `/^/admin/api/` (an empty regex followed by invalid flags). Both broke
    // the entire script at parse time, so the deployed page rendered only
    // the static header with nothing underneath — no error visible to the
    // person looking at the page, only in devtools.
    assert.doesNotThrow(() => new Function(script), 'the inline script must be valid JS');
  });

  it('derives its API base correctly from whatever path it is served at', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/admin'), env);
    const script = (await res.text()).split('<script>')[1].split('</script>')[0];

    // Pull the two path-handling lines out of the emitted script and run them
    // for real. A syntax check is not enough here: the earlier bug produced
    // `/\\/+$/`, which PARSES fine (a regex followed by `+`) while behaving
    // completely differently. Only executing it catches that.
    const baseLine = script.split('\n').find(l => l.includes('ADMIN_BASE ='))!;
    const targetLine = script.split('\n').find(l => l.includes('path.replace('))!;
    assert.ok(baseLine && targetLine, 'both path lines must be present');

    const run = new Function('pathname', 'path', 'API', `
      var location = { pathname: pathname };
      ${baseLine.trim()}
      ${targetLine.trim()}
      return { base: ADMIN_BASE, target: target };
    `) as (p: string, path: string, api: string) => { base: string; target: string };

    // Served at the default path.
    assert.deepEqual(run('/admin', '/admin/api/overview', ''), {
      base: '/admin',
      target: '/admin/api/overview',
    });
    // Served at a secret path: the API base must follow it.
    assert.deepEqual(run('/console-7fq2xk', '/admin/api/overview', ''), {
      base: '/console-7fq2xk',
      target: '/console-7fq2xk/api/overview',
    });
    // A trailing slash must not produce a doubled separator.
    assert.equal(run('/console-7fq2xk/', '/admin/api/session', '').target,
      '/console-7fq2xk/api/session');
  });

  it('allows its own embedded fonts under CSP', async () => {
    const res = await worker.fetch(new Request('https://proxy.test/admin'), env);
    assert.match(res.headers.get('content-security-policy') ?? '', /font-src data:/);
  });
});

describe('the console does not exist unless switched on', () => {
  it('404s the whole dashboard when ADMIN_CONSOLE_ENABLED is unset', async () => {
    // Production leaves it unset: the console is absent, not hidden.
    delete (env as { ADMIN_CONSOLE_ENABLED?: string }).ADMIN_CONSOLE_ENABLED;

    const shell = await worker.fetch(new Request('https://proxy.test/admin'), env);
    assert.equal(shell.status, 404);

    for (const [method, path] of EVERY_ADMIN_ROUTE) {
      const res = await worker.fetch(
        jsonRequest(path, { reason: 'x' }, {}, method),
        env,
      );
      assert.equal(res.status, 404, `${method} ${path} must not exist`);
    }
  });

  it('404s even for a genuine admin session', async () => {
    // Switch it on only long enough to create an admin, then switch it off.
    (env as { ADMIN_CONSOLE_ENABLED?: string }).ADMIN_CONSOLE_ENABLED = 'true';
    const admin = await bootstrapAdmin('switched-off-admin');
    delete (env as { ADMIN_CONSOLE_ENABLED?: string }).ADMIN_CONSOLE_ENABLED;

    const res = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    assert.equal(res.status, 404);
  });

  it('leaves the public account and chat API untouched', async () => {
    delete (env as { ADMIN_CONSOLE_ENABLED?: string }).ADMIN_CONSOLE_ENABLED;
    const res = await worker.fetch(
      jsonRequest('/auth/anonymous', {}, { 'x-alice-install-id': 'install-gate-000000001' }),
      env,
    );
    assert.equal(res.status, 200);
  });
});

describe('daily series carry real numbers', () => {
  it('buckets confirmed requests onto the right day', async () => {
    const admin = await bootstrapAdmin('series-admin');
    const user = await registerAccount('series-user');
    const now = Date.now();
    const DAY = 86_400_000;

    // Three confirmed requests today, two the day before.
    const rows: [string, number][] = [
      ['r1', now - 1_000], ['r2', now - 2_000], ['r3', now - 3_000],
      ['r4', now - DAY], ['r5', now - DAY - 1_000],
    ];
    for (const [id, at] of rows) {
      await db.prepare(`
        INSERT INTO cloud_request_ledger (
          id, user_id, idempotency_key, request_type, status, units, created_at, confirmed_at
        ) VALUES (?, ?, ?, 'standard', 'confirmed', 1, ?, ?)
      `).bind(id, user.account.user_id, `key-${id}`, at, at).run();
    }

    const res = await worker.fetch(
      jsonRequest('/admin/api/overview', {}, bearer(admin.access_token), 'GET'),
      env,
    );
    const body = await res.json() as {
      requests_7d: number;
      series: { requests: { day: number; count: number }[] };
    };

    assert.equal(body.requests_7d, 5, 'the headline count must see all five');

    // The regression this guards: binding the divisor made SQLite divide in
    // floating point, so `created_at / 86400000` came back as 20669.000057…
    // and never matched an integer day bucket. Every count silently became
    // zero while the headline figures stayed correct — a chart that says
    // "nothing recorded" next to a card saying 32.
    const total = body.series.requests.reduce((sum, point) => sum + point.count, 0);
    assert.equal(total, 5, 'the daily series must add up to the same five');

    const today = Math.floor(now / DAY);
    assert.equal(body.series.requests.find(p => p.day === today)?.count, 3);
    assert.equal(body.series.requests.find(p => p.day === today - 1)?.count, 2);
    assert.equal(body.series.requests.length, 30, 'gaps must be filled with zeros');
  });
});
