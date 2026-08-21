# The test wallet faucet

The test wallet hands a learner 2100 Mutinynet sats, once, so their first
transaction can happen without them going looking for coins first. This
describes how that faucet is created, funded, watched and switched off.

Every command below runs from the repository root.

## Why Alice dispenses instead of relaying

The public Mutinynet faucet issues a token through its own page before it will
pay anything, which is its defence against automated draining. That check
cannot be relayed from a server without defeating it, so Alice does not try:
she pays from a wallet she funds herself. The coins are Mutinynet coins, worth
nothing anywhere, and the only thing being protected is the float.

## What bounds the spending

Two limits, and deliberately nothing derived from the caller's IP address.

- **One payout per installation, for life.** The installation identifier is the
  one Alice already generates in the browser. It is stored as an HMAC, so the
  faucet knows "this one has claimed" without holding a list of installations
  or of the addresses it funded.
- **One hundred payouts a day, platform-wide.** About 238k sats a day at the
  worst, whatever happens. This is the backstop against someone clearing site
  data to mint themselves a fresh installation.

An identifier can be reset by clearing site data, so the first limit is a
fairness rule rather than a security boundary. The second is the one that
actually bounds the loss.

## Creating the wallet

```bash
node scripts/test-wallet-faucet.mjs new
```

It prints a fresh recovery phrase and the address to fund. Both are Mutinynet
only. Never put real bitcoin behind this phrase: it lives in a Worker secret
and is used by an automated payout route, which is the opposite of how a
phrase holding value should be treated.

Fund the printed address from https://faucet.mutinynet.com. A million sats
covers about 476 learners; the wallet can be topped up at the same address at
any time.

Then store the phrase as the Worker secret:

```bash
cd apps/venice-proxy-worker && npx wrangler secret put TEST_WALLET_FAUCET_MNEMONIC
```

Clear the terminal afterwards so the phrase leaves the scrollback.

## Preparing the database

Two migrations back the faucet: `0013_test_wallet_faucet.sql` creates the lease
that serializes payouts, `0014_test_wallet_faucet_claims.sql` records the
once-per-learner claims.

They must be applied from a checkout that actually contains them. Running the
command from a working copy parked on another branch applies that branch's
migrations instead, silently and against the same production database.

```bash
cd apps/venice-proxy-worker && npx wrangler d1 migrations apply alice-accounts --remote
```

## Deploying

The faucet route ships with the Worker, so it needs no separate deployment
path. After the migrations and Wrangler configuration are ready, deploy from
`apps/venice-proxy-worker` with `npx wrangler deploy`.

## Watching the float

The admin console has a **Faucet** tab: the top-up address with a copy button,
the float and how many payouts it still covers, today's share of the daily cap,
payouts per day over the last month, and take-up over today / 7d / 30d / all
time. It is read-only, and read-only about the right things: the recovery
phrase is never returned by the API, and neither is any payout transaction or
recipient, so nothing on that page points back at a learner's wallet.

The console runs locally, from a `wrangler dev` reading `.dev.vars`, so it is
configured separately from the deployed Worker. What it needs there is the
faucet's account public key, never the phrase:

```bash
node scripts/test-wallet-faucet.mjs xpub
```

Put the printed key in `apps/venice-proxy-worker/.dev.vars` as
`TEST_WALLET_FAUCET_XPUB`. It derives the same addresses and can do nothing
else, so the console reads the float without ever holding the means to move
it. With only that key the page reports the faucet as not configured, which is
the truth from where it stands: it can see the reserve, not the ability to pay
from it.

From a terminal, without the console:

```bash
node scripts/test-wallet-faucet.mjs balance
```

It asks for the phrase with the input hidden, scans the wallet's chains and
prints how many payouts are left. The payout response also carries a
`lowBalance` flag once the wallet drops below 50k sats.

## Paying someone by hand

Topping up a test wallet, refunding a learner whose claim went wrong, or
emptying the float back out:

```bash
node scripts/test-wallet-faucet.mjs send tb1... 10000
```

It builds the whole transaction, prints it and stops. Adding `--yes` to the
same command is what broadcasts it. `max` in place of an amount empties the
float into a single output, which is how a dispensing wallet is retired into a
fresh one.

The confirmation is a flag rather than a second question on purpose. The
phrase prompt is the only thing any command reads from stdin: asking a second
question through a second readline made the terminal re-echo the buffered
phrase into it, printing the live faucet phrase in plain sight.

This goes around the Worker entirely, so neither the daily cap nor the
once-per-learner rule applies.

## Rotating the dispensing wallet

If the phrase is ever seen by anything other than the Worker, it is burnt and
the float has to move. Create the replacement, empty the old wallet into it,
wait for the sweep to confirm, and only then swap the secret: the faucet pays
from whatever the secret holds, so a secret changed too early pays from an
empty wallet.

## Switching it off

Remove the secret:

```bash
cd apps/venice-proxy-worker && npx wrangler secret delete TEST_WALLET_FAUCET_MNEMONIC
```

The route then answers `503 faucet_not_configured` and the app falls back on
its own: it copies the learner's address and opens the public Mutinynet faucet
for them. Nothing breaks, and the same is true before the faucet has ever been
turned on, which is why the test wallet can ship with it switched off.

## The payout itself

One payout builds one transaction: it gathers the wallet's coins across the
first twenty addresses of each chain, plans a spend at the current two-block
fee rate with change returning to the wallet, signs it, re-decodes the signed
bytes and checks them against the plan, and only then broadcasts. That last
check is the same one the test wallet teaches learners to make before they
sign anything.

Payouts are serialized through a single-row lease in D1, because the wallet
spends its own change in a chain and two concurrent payouts would build
conflicting transactions. The lease expires after thirty seconds, so a crashed
request cannot wedge the faucet shut. It is taken before the daily cap is
consumed: someone who arrives while another payout is in flight is asked to
retry, and must not lose their claim to a queue.
