import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Miniflare } from 'miniflare';
import worker, { type Env } from './index.ts';
import { AccountHttpError } from './account.ts';
import {
  PracticeEsploraClient,
  PracticeKeyring,
  generatePracticeMnemonic,
} from '@alice-wallet/practice-wallet';
import {
  TEST_WALLET_FAUCET_SATS,
  claimTestWalletFaucet,
  testWalletFaucetStatus,
} from './test-wallet-faucet.ts';

let miniflare: Miniflare;
let db: D1Database;
let env: Env;

const AUTH_SECRET = 'alice-test-hmac-secret-with-more-than-thirty-two-bytes';
// The dispensing wallet for these tests; valueless by construction.
const FAUCET_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const RECIPIENT = 'tb1qrrlkhlg5fvzshmk3lyflvesvqvuyxw80r596th';
const BROADCAST_TXID = 'ab'.repeat(32);
const NOW = 1_755_000_000_000;

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
    TEST_WALLET_FAUCET_MNEMONIC: FAUCET_MNEMONIC,
  } as Env;
});

afterEach(async () => {
  await miniflare.dispose();
});

function claimRequest(body: unknown, ip = '203.0.113.7', installId?: string): Request {
  return new Request('https://proxy.test/test-wallet/faucet', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
      ...(installId ? { 'x-alice-install-id': installId } : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * An Esplora stand-in: the dispensing wallet owns one coin on its first
 * receive address, and broadcasts are captured rather than sent.
 */
function fakeChain(options: { fundingSats?: number; broadcastFails?: boolean } = {}) {
  const { fundingSats = 500_000, broadcastFails = false } = options;
  const keyring = new PracticeKeyring(FAUCET_MNEMONIC);
  const funded = keyring.addressAt(false, 0).address;
  const broadcasts: string[] = [];
  const client = {
    getAddressUtxos: (address: string) =>
      Promise.resolve(
        address === funded && fundingSats > 0
          ? [{ txid: 'cd'.repeat(32), vout: 0, valueSats: fundingSats, confirmed: true }]
          : [],
      ),
    recommendedFeeRate: () => Promise.resolve(2),
    broadcastTx: (hex: string) => {
      broadcasts.push(hex);
      return broadcastFails
        ? Promise.reject(new Error('min relay fee not met'))
        : Promise.resolve(BROADCAST_TXID);
    },
  } as unknown as PracticeEsploraClient;
  return { client, broadcasts, keyring };
}

describe('test wallet faucet', () => {
  it('pays the fixed amount and broadcasts a signed transaction', async () => {
    const chain = fakeChain();
    const result = await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT, walletId: 'wallet-pay', sats: 1_000_000 }),
      env,
      NOW,
      { client: chain.client },
    );
    assert.equal(result.sats, TEST_WALLET_FAUCET_SATS);
    assert.equal(result.txid, BROADCAST_TXID);
    assert.equal(result.lowBalance, false);
    assert.equal(chain.broadcasts.length, 1);
    assert.match(chain.broadcasts[0], /^[0-9a-f]+$/);
  });

  it('rejects anything that is not a Mutinynet address', async () => {
    const chain = fakeChain();
    for (const address of ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'not-an-address', '', 42]) {
      await assert.rejects(
        () => claimTestWalletFaucet(claimRequest({ address }), env, NOW, { client: chain.client }),
        (error: unknown) =>
          error instanceof AccountHttpError && error.code === 'invalid_address' && error.status === 400,
      );
    }
    assert.equal(chain.broadcasts.length, 0);
  });

  it('never turns anyone away for sharing a connection', async () => {
    const chain = fakeChain();
    // A classroom: many learners, one IP, same day. Each gets its sats.
    for (const learner of ['alice_install_one__x', 'alice_install_two__x', 'alice_install_three']) {
      const result = await claimTestWalletFaucet(
        claimRequest({ address: RECIPIENT }, '203.0.113.7', learner),
        env, NOW, { client: chain.client },
      );
      assert.equal(result.sats, TEST_WALLET_FAUCET_SATS);
    }
  });

  it('caps the platform at a hundred payouts a day, then reopens', async () => {
    const chain = fakeChain();
    for (let i = 0; i < 100; i += 1) {
      await claimTestWalletFaucet(
        claimRequest({ address: RECIPIENT }, '203.0.113.7', `alice_install_${String(i).padStart(12, '0')}`),
        env, NOW, { client: chain.client },
      );
    }
    await assert.rejects(
      () => claimTestWalletFaucet(
        claimRequest({ address: RECIPIENT }, '203.0.113.7', 'alice_install_one_too_many'),
        env, NOW, { client: chain.client },
      ),
      (error: unknown) =>
        error instanceof AccountHttpError
        && error.status === 429
        && error.code === 'faucet_exhausted'
        // The message must blame the float, never the person asking.
        && error.message.includes('all her test sats for today'),
    );
    // The following day the float opens again.
    const tomorrow = await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT }, '203.0.113.7', 'alice_install_next_day__'),
      env, NOW + 24 * 60 * 60 * 1000, { client: chain.client },
    );
    assert.equal(tomorrow.sats, TEST_WALLET_FAUCET_SATS);
  });

  it('pays one installation once for life, whatever the day, IP or wallet', async () => {
    const chain = fakeChain();
    const INSTALL = 'alice_installation_abcdefgh';
    await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT, walletId: 'wallet-a' }, '203.0.113.7', INSTALL),
      env, NOW, { client: chain.client },
    );
    // Another day, another IP, and even a brand new test wallet: still one.
    await assert.rejects(
      () => claimTestWalletFaucet(
        claimRequest({ address: RECIPIENT, walletId: 'wallet-b' }, '198.51.100.3', INSTALL),
        env, NOW + 400 * 24 * 60 * 60 * 1000, { client: chain.client },
      ),
      (error: unknown) =>
        error instanceof AccountHttpError && error.code === 'already_claimed' && error.status === 409,
    );
    // A different installation is a different learner.
    const other = await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT, walletId: 'wallet-c' }, '198.51.100.4', 'alice_other_installation_x'),
      env, NOW, { client: chain.client },
    );
    assert.equal(other.sats, TEST_WALLET_FAUCET_SATS);
  });

  it('falls back to the wallet identity when no installation id is sent', async () => {
    const chain = fakeChain();
    await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT, walletId: 'wallet-forever' }), env, NOW, { client: chain.client },
    );
    for (const [day, ip] of [[1, '198.51.100.1'], [400, '203.0.113.9']] as const) {
      await assert.rejects(
        () => claimTestWalletFaucet(
          claimRequest({ address: RECIPIENT, walletId: 'wallet-forever' }, ip),
          env,
          NOW + day * 24 * 60 * 60 * 1000,
          { client: chain.client },
        ),
        (error: unknown) =>
          error instanceof AccountHttpError && error.code === 'already_claimed' && error.status === 409,
      );
    }
    // Rotating the payout address does not buy a second claim.
    await assert.rejects(
      () => claimTestWalletFaucet(
        claimRequest({ address: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', walletId: 'wallet-forever' }, '198.51.100.7'),
        env,
        NOW + 5 * 24 * 60 * 60 * 1000,
        { client: chain.client },
      ),
      (error: unknown) => error instanceof AccountHttpError && error.code === 'already_claimed',
    );
  });

  it('does not burn the lifetime claim when the payout fails', async () => {
    const failing = fakeChain({ broadcastFails: true });
    await assert.rejects(
      () => claimTestWalletFaucet(
        claimRequest({ address: RECIPIENT, walletId: 'wallet-retry' }), env, NOW, { client: failing.client },
      ),
      (error: unknown) => error instanceof AccountHttpError && error.code === 'faucet_failed',
    );
    // The float is back: the same wallet must still get its one payout.
    const working = fakeChain();
    const result = await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT, walletId: 'wallet-retry' }),
      env,
      NOW,
      { client: working.client },
    );
    assert.equal(result.sats, TEST_WALLET_FAUCET_SATS);
  });

  it('counts sats handed out, not attempts, against the daily cap', async () => {
    // Three learners whose payout could not be broadcast, plus one served.
    // The day has spent one payout, and the console must say one: a counter
    // incremented per attempt would read four and close the faucet early.
    for (const learner of ['alice_install_fail_a__', 'alice_install_fail_b__', 'alice_install_fail_c__']) {
      const failing = fakeChain({ broadcastFails: true });
      await assert.rejects(
        () => claimTestWalletFaucet(
          claimRequest({ address: RECIPIENT }, '203.0.113.7', learner),
          env, NOW, { client: failing.client },
        ),
        (error: unknown) => error instanceof AccountHttpError && error.code === 'faucet_failed',
      );
    }
    const chain = fakeChain();
    await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT }, '203.0.113.7', 'alice_install_served_x'),
      env, NOW, { client: chain.client },
    );
    const status = await testWalletFaucetStatus(env, NOW, { client: chain.client });
    assert.equal(status.claims?.today, 1);
  });

  it('reports an empty float instead of failing obscurely', async () => {
    const chain = fakeChain({ fundingSats: 0 });
    await assert.rejects(
      () => claimTestWalletFaucet(claimRequest({ address: RECIPIENT }), env, NOW, { client: chain.client }),
      (error: unknown) =>
        error instanceof AccountHttpError && error.code === 'faucet_empty' && error.status === 503,
    );
  });

  it('flags a low float so the wallet can be topped up before it runs dry', async () => {
    const chain = fakeChain({ fundingSats: 20_000 });
    const result = await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT, walletId: 'wallet-low' }),
      env,
      NOW,
      { client: chain.client },
    );
    assert.equal(result.lowBalance, true);
  });

  it('surfaces a refused broadcast without inventing a txid', async () => {
    const chain = fakeChain({ broadcastFails: true });
    await assert.rejects(
      () => claimTestWalletFaucet(claimRequest({ address: RECIPIENT }), env, NOW, { client: chain.client }),
      (error: unknown) =>
        error instanceof AccountHttpError && error.code === 'faucet_failed' && error.status === 502,
    );
  });

  it('serializes payouts: a second one cannot start while the lease is held', async () => {
    const chain = fakeChain();
    // Take the lease as if a payout were in flight.
    await db.prepare('UPDATE test_wallet_faucet_lock SET locked_until = ? WHERE id = 1')
      .bind(NOW + 30_000).run();
    await assert.rejects(
      () => claimTestWalletFaucet(
        claimRequest({ address: RECIPIENT, walletId: 'wallet-busy' }), env, NOW, { client: chain.client },
      ),
      (error: unknown) =>
        error instanceof AccountHttpError && error.code === 'faucet_busy' && error.status === 503,
    );
    // An expired lease must not wedge the faucet shut. This retry also proves
    // that being turned away by a busy faucet did not spend the caller's one
    // claim of the day: same IP, same day, and it goes through.
    const later = await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT, walletId: 'wallet-busy' }),
      env,
      NOW + 60_000,
      { client: chain.client },
    );
    assert.equal(later.sats, TEST_WALLET_FAUCET_SATS);
  });

  it('releases the lease even when the payout fails', async () => {
    const chain = fakeChain({ broadcastFails: true });
    await assert.rejects(
      () => claimTestWalletFaucet(claimRequest({ address: RECIPIENT }), env, NOW, { client: chain.client }),
      (error: unknown) => error instanceof AccountHttpError,
    );
    const lock = await db.prepare('SELECT locked_until FROM test_wallet_faucet_lock WHERE id = 1')
      .first<{ locked_until: number }>();
    assert.equal(lock?.locked_until, 0);
  });

  it('turns itself off cleanly when no dispensing wallet is configured', async () => {
    const chain = fakeChain();
    await assert.rejects(
      () => claimTestWalletFaucet(
        claimRequest({ address: RECIPIENT }),
        { ACCOUNT_DB: db, AUTH_HMAC_KEY: AUTH_SECRET } as Env,
        NOW,
        { client: chain.client },
      ),
      (error: unknown) =>
        error instanceof AccountHttpError && error.code === 'faucet_not_configured' && error.status === 503,
    );
  });

  it('is reachable from the Worker dispatcher, without a Venice key', async () => {
    // Regression guard: the route lives outside the /auth and /account
    // prefixes, so it has to be dispatched with the other public routes.
    // Wired wrongly it falls through to the Venice proxy and answers
    // "Proxy is not configured" instead of ever running.
    const response = await worker.fetch(
      claimRequest({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' }),
      { ...env, VENICE_API_KEY: '' } as Env,
    );
    assert.equal(response.status, 400);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, 'invalid_address');
  });

  it('generates dispensing mnemonics that derive Mutinynet addresses', () => {
    // The operator funds the address this prints; a wrong network here would
    // silently send the float somewhere unspendable.
    const keyring = new PracticeKeyring(generatePracticeMnemonic());
    assert.match(keyring.addressAt(false, 0).address, /^tb1q[0-9a-z]{38}$/);
  });
});

describe('test wallet faucet status', () => {
  it('reports the float, the top-up address and the take-up', async () => {
    const chain = fakeChain({ fundingSats: 500_000 });
    await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT }, '203.0.113.7', 'install-status-one'),
      env, NOW, { client: chain.client },
    );

    const status = await testWalletFaucetStatus(env, NOW, { client: chain.client });
    assert.equal(status.configured, true);
    assert.equal(status.payoutSats, TEST_WALLET_FAUCET_SATS);
    // The address an operator funds is the dispensing wallet's own first
    // receive address, not any address a payout went to.
    assert.equal(status.wallet?.address, chain.keyring.addressAt(false, 0).address);
    assert.equal(status.wallet?.balanceSats, 500_000);
    assert.ok((status.wallet?.payoutsLeft ?? 0) > 200);
    assert.equal(status.claims?.total, 1);
    assert.equal(status.claims?.today, 1);
    assert.equal(status.claims?.byDay.length, 1);
    assert.equal(status.claims?.byDay[0]?.count, 1);
    assert.equal(status.payingOut, false);
  });

  it('never exposes the recovery phrase or who received a payout', async () => {
    const chain = fakeChain();
    await claimTestWalletFaucet(
      claimRequest({ address: RECIPIENT }, '203.0.113.7', 'install-status-two'),
      env, NOW, { client: chain.client },
    );

    const serialized = JSON.stringify(await testWalletFaucetStatus(env, NOW, { client: chain.client }));
    for (const word of FAUCET_MNEMONIC.split(' ')) {
      assert.ok(!new RegExp('"[^"]*\\\\b' + word + '\\\\b').test(serialized), `leaked a phrase word: ${word}`);
    }
    assert.ok(!serialized.includes(RECIPIENT), 'leaked the address a payout went to');
    assert.ok(!serialized.includes(BROADCAST_TXID), 'leaked a payout transaction');
  });

  it('flags a low float so the wallet is topped up before it runs dry', async () => {
    const chain = fakeChain({ fundingSats: 20_000 });
    const status = await testWalletFaucetStatus(env, NOW, { client: chain.client });
    assert.equal(status.wallet?.low, true);
    assert.equal(status.claims?.total, 0);
  });

  it('says the faucet is off rather than pretending it is empty', async () => {
    const status = await testWalletFaucetStatus(
      { ...env, TEST_WALLET_FAUCET_MNEMONIC: undefined } as Env,
      NOW,
    );
    assert.equal(status.configured, false);
    assert.equal(status.wallet, null);
    // The counters still read: turning the faucet off must not blank the
    // history of what it already handed out.
    assert.equal(status.claims?.total, 0);
  });

  it('reports unreadable counters instead of failing the page', async () => {
    await db.prepare('DROP TABLE test_wallet_faucet_claims').run();
    const chain = fakeChain();
    const status = await testWalletFaucetStatus(env, NOW, { client: chain.client });
    assert.equal(status.claims, null);
    assert.match(status.claimsError ?? '', /test_wallet_faucet_claims|no such table/i);
    // The wallet half is independent, so a missing migration still leaves the
    // float visible.
    assert.equal(status.wallet?.balanceSats, 500_000);
  });

  it('reports a chain it cannot reach instead of showing a zero balance', async () => {
    const broken = {
      getAddressUtxos: () => Promise.reject(new Error('esplora unreachable')),
    } as unknown as PracticeEsploraClient;
    const status = await testWalletFaucetStatus(env, NOW, { client: broken });
    assert.equal(status.wallet, null);
    assert.match(status.walletError ?? '', /unreachable/);
  });
});

describe('test wallet faucet, watched through a public key', () => {
  it('reports the float without holding anything that can spend it', async () => {
    const chain = fakeChain({ fundingSats: 500_000 });
    const xpub = new PracticeKeyring(FAUCET_MNEMONIC).accountXpub();
    // The console's environment: the account key, and deliberately no phrase.
    const watching = { ...env, TEST_WALLET_FAUCET_MNEMONIC: undefined, TEST_WALLET_FAUCET_XPUB: xpub } as Env;

    const status = await testWalletFaucetStatus(watching, NOW, { client: chain.client });
    assert.equal(status.wallet?.balanceSats, 500_000);
    assert.equal(status.wallet?.address, chain.keyring.addressAt(false, 0).address);
    assert.equal(status.walletError, null);
    // It can read the float, and it says plainly that it cannot see a faucet
    // able to pay it, because the phrase lives in the Worker's secrets.
    assert.equal(status.configured, false);

    const serialized = JSON.stringify(status);
    for (const word of FAUCET_MNEMONIC.split(' ')) {
      assert.ok(!new RegExp('"[^"]*\\\\b' + word + '\\\\b').test(serialized), `leaked a phrase word: ${word}`);
    }
    assert.ok(!serialized.includes(xpub), 'the account key is not the console operator business either');
  });

  it('says what is wrong instead of showing an empty float', async () => {
    const chain = fakeChain();
    const broken = { ...env, TEST_WALLET_FAUCET_MNEMONIC: undefined, TEST_WALLET_FAUCET_XPUB: 'not-a-key' } as Env;
    const status = await testWalletFaucetStatus(broken, NOW, { client: chain.client });
    assert.equal(status.wallet, null);
    assert.match(status.walletError ?? '', /account key/i);
  });
});
