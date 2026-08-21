import type { Env } from './index.ts';
import { AccountHttpError, hmac } from './account.ts';
import {
  PracticeEsploraClient,
  PracticeKeyring,
  planPracticeTransaction,
  reviewPracticeTransaction,
  signPracticeTransaction,
  type PracticeUtxo,
} from '@alice-wallet/practice-wallet';

// Alice's own Mutinynet faucet for the test wallet.
//
// The public Mutinynet faucet requires a token issued through its own page,
// so it cannot be relayed server-side. Instead Alice dispenses from a wallet
// she funds herself: the coins are valueless Mutinynet sats, the payout is
// fixed server-side, it is handed out once per installation, and a
// platform-wide daily cap bounds how fast the wallet can be drained.
//
// Payouts are serialized through a D1 lease: the dispensing wallet spends its
// own change in a chain, so two concurrent payouts would build conflicting
// transactions.

/** Fixed payout; the client cannot ask for more, or for a second one. */
export const TEST_WALLET_FAUCET_SATS = 2_100;

// Two bounds, and deliberately nothing derived from the caller's IP:
//   - one claim per installation, for life: the intended "once per learner",
//     and the only thing a refusal ever talks about, so the message is always
//     true for the person reading it. Nobody is ever turned away because of
//     what someone else on their connection did;
//   - one hundred claims a day platform-wide: caps the float's burn rate at
//     roughly 238k sats a day whatever happens, which is the backstop for
//     someone clearing site data to mint themselves a new installation.
//
// If that backstop is ever not enough, the faucet is switched off by removing
// the TEST_WALLET_FAUCET_MNEMONIC secret: the route then answers cleanly and
// the app falls back to the public Mutinynet faucet.
const GLOBAL_CLAIMS_PER_DAY = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** How long one payout may hold the lease before it is considered dead. */
const LOCK_TTL_MS = 30_000;

/** Addresses scanned on each chain when gathering the wallet's coins. */
const SCAN_DEPTH = 20;

/** Warn in the response once the float drops below a few hundred payouts. */
const LOW_BALANCE_SATS = 50_000;

// Bech32 payload charset; enough to reject garbage before it reaches the
// transaction builder, which stays the real validator.
const MUTINYNET_ADDRESS = /^tb1[02-9ac-hj-np-z]{6,87}$/;

export type FaucetPayout = {
  txid: string;
  sats: number;
  /** True once the dispensing wallet is running low, for monitoring. */
  lowBalance: boolean;
};

export type FaucetStatus = {
  configured: boolean;
  payoutSats: number;
  dailyCap: number;
  lowBalanceSats: number;
  /** True while a payout holds the lease, so a busy faucet reads as busy. */
  payingOut: boolean;
  /** Null until the faucet's tables exist; the reason is reported instead. */
  claims: {
    total: number;
    today: number;
    last7d: number;
    last30d: number;
    firstAt: number | null;
    lastAt: number | null;
    byDay: Array<{ day: number; count: number }>;
  } | null;
  claimsError: string | null;
  /** Null when no dispensing wallet is configured, or when Esplora is down. */
  wallet: {
    address: string;
    changeAddress: string;
    balanceSats: number;
    confirmedSats: number;
    pendingSats: number;
    coins: number;
    payoutsLeft: number;
    low: boolean;
  } | null;
  walletError: string | null;
};

/**
 * What the admin console shows about the faucet.
 *
 * Deliberately aggregate and one-directional. It reports the dispensing
 * wallet's own address and float, and counts of payouts; it never returns the
 * recovery phrase, never a claimer identifier, and never a payout transaction
 * id, which would lead straight to the address of the learner who received it.
 * The claims table holds only an HMAC and a timestamp, so there is nothing
 * finer to return even if it were asked for.
 *
 * Nothing here can move funds. It is a read of the chain and of two counters.
 */
export async function testWalletFaucetStatus(
  env: Env,
  now: number = Date.now(),
  deps: { client?: PracticeEsploraClient } = {},
): Promise<FaucetStatus> {
  // "Configured" means the faucet can pay, which only the phrase allows. A
  // console watching through a public key reports the float of a faucet whose
  // ability to pay it cannot see, and says so rather than guessing.
  const configured = Boolean(env.TEST_WALLET_FAUCET_MNEMONIC);
  const status: FaucetStatus = {
    configured,
    payoutSats: TEST_WALLET_FAUCET_SATS,
    dailyCap: GLOBAL_CLAIMS_PER_DAY,
    lowBalanceSats: LOW_BALANCE_SATS,
    payingOut: false,
    claims: null,
    claimsError: null,
    wallet: null,
    walletError: null,
  };

  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;

  try {
    const [totals, byDay, lock] = await Promise.all([
      env.ACCOUNT_DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN claimed_at >= ? THEN 1 ELSE 0 END) AS today,
          SUM(CASE WHEN claimed_at >= ? THEN 1 ELSE 0 END) AS last7d,
          SUM(CASE WHEN claimed_at >= ? THEN 1 ELSE 0 END) AS last30d,
          MIN(claimed_at) AS first_at,
          MAX(claimed_at) AS last_at
        FROM test_wallet_faucet_claims
      `).bind(dayStart, now - 7 * DAY_MS, now - 30 * DAY_MS).first<Record<string, number | null>>(),

      env.ACCOUNT_DB.prepare(`
        SELECT claimed_at / 86400000 AS day, COUNT(*) AS count
        FROM test_wallet_faucet_claims
        WHERE claimed_at >= ?
        GROUP BY day
        ORDER BY day
      `).bind(now - 30 * DAY_MS).all<{ day: number; count: number }>(),

      env.ACCOUNT_DB.prepare('SELECT locked_until FROM test_wallet_faucet_lock WHERE id = 1')
        .first<{ locked_until: number }>(),
    ]);

    status.payingOut = (lock?.locked_until ?? 0) > now;
    status.claims = {
      total: Number(totals?.total ?? 0),
      today: Number(totals?.today ?? 0),
      last7d: Number(totals?.last7d ?? 0),
      last30d: Number(totals?.last30d ?? 0),
      firstAt: totals?.first_at ?? null,
      lastAt: totals?.last_at ?? null,
      byDay: (byDay?.results ?? []).map((row: { day: number; count: number }) => ({
        day: Number(row.day),
        count: Number(row.count),
      })),
    };
  } catch (cause) {
    // Almost always "no such table": the faucet migrations have not been
    // applied to this database yet. Say that rather than fail the page.
    status.claimsError = cause instanceof Error ? cause.message : 'The faucet tables are unreadable.';
  }

  // Reading the float must never require the ability to spend it. Given an
  // account public key the console watches the same addresses without holding
  // anything that can move a coin, which is what the local console gets: the
  // recovery phrase belongs in the Worker's secrets and nowhere else.
  const watching = (env.TEST_WALLET_FAUCET_XPUB ?? '').trim();
  if (!configured && !watching) return status;

  try {
    const keyring = watching
      ? PracticeKeyring.watching(watching)
      : new PracticeKeyring(env.TEST_WALLET_FAUCET_MNEMONIC!);
    const client = deps.client ?? new PracticeEsploraClient();
    const utxos = await collectWalletCoins(keyring, client);
    const balanceSats = utxos.reduce((sum, utxo) => sum + utxo.valueSats, 0);
    const pendingSats = utxos
      .filter((utxo) => !utxo.confirmed)
      .reduce((sum, utxo) => sum + utxo.valueSats, 0);
    // A payout is the fixed amount plus its fee; 200 sats covers a small
    // one-in two-out transaction at Mutinynet rates, so the count reads as
    // "payouts I can actually make", not "amount divided by amount".
    const perPayout = TEST_WALLET_FAUCET_SATS + 200;
    status.wallet = {
      address: keyring.addressAt(false, 0).address,
      changeAddress: keyring.addressAt(true, 0).address,
      balanceSats,
      confirmedSats: balanceSats - pendingSats,
      pendingSats,
      coins: utxos.length,
      payoutsLeft: Math.max(0, Math.floor((balanceSats - pendingSats) / perPayout)),
      low: balanceSats < LOW_BALANCE_SATS,
    };
  } catch (cause) {
    status.walletError = cause instanceof Error ? cause.message : 'The dispensing wallet is unreadable.';
  }

  return status;
}

/**
 * Who is claiming, for the once-in-a-lifetime rule.
 *
 * Alice's installation identifier first: it is generated in the browser,
 * survives IP changes and network switches, and says nothing about the
 * person. Clients that send none fall back to the test wallet's own identity
 * (its first receive address, which outlives address rotation). The two live
 * in separate namespaces so one can never be passed off as the other.
 *
 * None of this is a security boundary: an identifier can be reset by clearing
 * site data. It is a fairness bound on free, valueless coins, backed by the
 * daily caps.
 */
function claimerIdentity(request: Request, body: unknown, address: string): string {
  const installId = request.headers.get('x-alice-install-id')?.trim() ?? '';
  if (/^[a-zA-Z0-9_-]{16,128}$/.test(installId)) return `install:${installId}`;
  const walletId =
    body && typeof body === 'object' && typeof (body as { walletId?: unknown }).walletId === 'string'
      ? (body as { walletId: string }).walletId.trim().toLowerCase()
      : '';
  return `wallet:${walletId || address}`;
}

/** Claims the one lifetime payout, or refuses if this learner already had it. */
async function reserveLifetimeClaim(env: Env, claimer: string, now: number): Promise<void> {
  const claimerHash = await hmac(env, `test-wallet-faucet:${claimer}`);
  const inserted = await env.ACCOUNT_DB.prepare(`
    INSERT INTO test_wallet_faucet_claims (claimer_hash, claimed_at)
    VALUES (?, ?)
    ON CONFLICT (claimer_hash) DO NOTHING
    RETURNING claimer_hash
  `).bind(claimerHash, now).first<{ claimer_hash: string }>();
  if (!inserted) {
    throw new AccountHttpError(
      409,
      'already_claimed',
      'You already received your free test sats. The public Mutinynet faucet hands out more.',
    );
  }
}

/**
 * How many payouts have actually happened today.
 *
 * Counted from the claims themselves rather than from a counter incremented
 * per attempt. A claim row is written before the payout and removed again
 * whenever the payout fails, so this count is exactly "sats handed out
 * today", and it stays exact however many times a request is retried: there
 * is no increment to apply twice. The count includes the claim being served,
 * which is why the cap is compared with a strict greater-than.
 */
async function payoutsToday(env: Env, now: number): Promise<number> {
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const row = await env.ACCOUNT_DB.prepare(
    'SELECT COUNT(*) AS count FROM test_wallet_faucet_claims WHERE claimed_at >= ?',
  ).bind(dayStart).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/** Undoes the reservation when the payout itself could not go through. */
async function releaseLifetimeClaim(env: Env, claimer: string): Promise<void> {
  const claimerHash = await hmac(env, `test-wallet-faucet:${claimer}`);
  await env.ACCOUNT_DB.prepare('DELETE FROM test_wallet_faucet_claims WHERE claimer_hash = ?')
    .bind(claimerHash).run().catch(() => { /* a stuck row only costs one claim */ });
}

function parseAddress(body: unknown): string {
  const address =
    body && typeof body === 'object' && typeof (body as { address?: unknown }).address === 'string'
      ? (body as { address: string }).address.trim().toLowerCase()
      : '';
  if (!MUTINYNET_ADDRESS.test(address)) {
    throw new AccountHttpError(
      400,
      'invalid_address',
      'The faucet only pays Mutinynet addresses (they start with tb1).',
    );
  }
  return address;
}

async function acquireLock(env: Env, now: number): Promise<void> {
  const row = await env.ACCOUNT_DB.prepare(`
    UPDATE test_wallet_faucet_lock
    SET locked_until = ?
    WHERE id = 1 AND locked_until <= ?
    RETURNING id
  `).bind(now + LOCK_TTL_MS, now).first<{ id: number }>();
  if (!row) {
    throw new AccountHttpError(
      503,
      'faucet_busy',
      'The faucet is handing out sats to someone else. Try again in a few seconds.',
    );
  }
}

async function releaseLock(env: Env): Promise<void> {
  await env.ACCOUNT_DB.prepare(
    'UPDATE test_wallet_faucet_lock SET locked_until = 0 WHERE id = 1',
  ).run().catch(() => { /* the lease expires on its own */ });
}

/** Every coin the dispensing wallet can spend, across both chains. */
async function collectWalletCoins(
  keyring: PracticeKeyring,
  client: PracticeEsploraClient,
): Promise<PracticeUtxo[]> {
  const chains: Array<{ change: boolean; index: number }> = [];
  for (let index = 0; index < SCAN_DEPTH; index += 1) {
    chains.push({ change: false, index }, { change: true, index });
  }
  const scanned = await Promise.all(
    chains.map(async ({ change, index }) => {
      const info = keyring.addressAt(change, index);
      const utxos = await client.getAddressUtxos(info.address);
      return utxos.map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        valueSats: utxo.valueSats,
        address: info.address,
        change,
        index,
        confirmed: utxo.confirmed,
      }));
    }),
  );
  return scanned.flat();
}

export async function claimTestWalletFaucet(
  request: Request,
  env: Env,
  now: number = Date.now(),
  deps: { client?: PracticeEsploraClient } = {},
): Promise<FaucetPayout> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AccountHttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  const address = parseAddress(body);

  if (!env.TEST_WALLET_FAUCET_MNEMONIC) {
    throw new AccountHttpError(
      503,
      'faucet_not_configured',
      'Alice has no test sats to hand out right now.',
    );
  }

  const claimer = claimerIdentity(request, body, address);
  await reserveLifetimeClaim(env, claimer, now);

  // The lease is taken before the daily caps are consumed: someone who
  // arrives while another payout is in flight is asked to retry in a few
  // seconds, and must not have spent their one claim of the day on a queue.
  try {
    await acquireLock(env, now);
  } catch (cause) {
    await releaseLifetimeClaim(env, claimer);
    throw cause;
  }

  const keyring = new PracticeKeyring(env.TEST_WALLET_FAUCET_MNEMONIC);
  const client = deps.client ?? new PracticeEsploraClient();

  try {
    // The day's cap, read under the lease so no two payouts can both pass it.
    // A refusal here blames the float, never the person asking, and their
    // lifetime claim is handed back by the catch below so tomorrow still owes
    // them their sats.
    if (await payoutsToday(env, now) > GLOBAL_CLAIMS_PER_DAY) {
      throw new AccountHttpError(
        429,
        'faucet_exhausted',
        'Alice has handed out all her test sats for today. Come back tomorrow, '
          + 'or use the public Mutinynet faucet right away.',
      );
    }

    const utxos = await collectWalletCoins(keyring, client);
    const available = utxos.reduce((sum, utxo) => sum + utxo.valueSats, 0);
    if (available === 0) {
      throw new AccountHttpError(
        503,
        'faucet_empty',
        'Alice has run out of test sats. Use the public Mutinynet faucet in the meantime.',
      );
    }

    const feeRateSatVb = await client.recommendedFeeRate(2);
    // Change comes back on the chain the wallet already uses, so the float
    // stays gatherable by the same scan on the next payout.
    const changeAddress = keyring.addressAt(true, 0).address;
    let plan;
    try {
      plan = planPracticeTransaction({
        utxos,
        recipientAddress: address,
        amountSats: TEST_WALLET_FAUCET_SATS,
        feeRateSatVb,
        changeAddress,
      });
    } catch (cause) {
      throw new AccountHttpError(
        503,
        'faucet_empty',
        `Alice cannot fund this claim right now. ${cause instanceof Error ? cause.message : ''}`.trim(),
      );
    }

    const signed = signPracticeTransaction(plan, keyring);
    // Verify the signed bytes against the plan before broadcasting: the same
    // check the wallet teaches its users to make.
    const review = reviewPracticeTransaction(signed.txHex, plan);
    if (!review.matchesPlan) {
      throw new AccountHttpError(
        500,
        'faucet_failed',
        `The payout failed verification and was not broadcast: ${review.issues.join(' ')}`,
      );
    }

    let txid: string;
    try {
      txid = await client.broadcastTx(signed.txHex);
    } catch (cause) {
      throw new AccountHttpError(
        502,
        'faucet_failed',
        `Mutinynet refused the payout. ${cause instanceof Error ? cause.message : ''}`.trim(),
      );
    }

    return {
      txid,
      sats: TEST_WALLET_FAUCET_SATS,
      lowBalance: available - plan.amountSats - plan.feeSats < LOW_BALANCE_SATS,
    };
  } catch (cause) {
    // Nothing was paid out, so the wallet keeps its one lifetime claim.
    await releaseLifetimeClaim(env, claimer);
    throw cause;
  } finally {
    await releaseLock(env);
  }
}
