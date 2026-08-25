#!/usr/bin/env node
// Operate Alice's own Mutinynet faucet wallet, the one that pays the test
// wallet's 2100 sats welcome gift.
//
// The public Mutinynet faucet issues a token through its own page and cannot
// be relayed server-side, so Alice dispenses from a wallet she funds herself.
// That wallet lives entirely in one Worker secret, TEST_WALLET_FAUCET_MNEMONIC;
// removing the secret switches the faucet off cleanly and the app falls back
// to sending learners to the public faucet.
//
// Usage:
//   node scripts/test-wallet-faucet.mjs new              create the wallet, print its funding address
//   node scripts/test-wallet-faucet.mjs balance          how much float is left, and for how many payouts
//   node scripts/test-wallet-faucet.mjs send <addr> <n>  pay n sats by hand (or `max` to empty the float)
//   node scripts/test-wallet-faucet.mjs xpub             the watch-only key the admin console needs
//
// `balance` and `send` ask for the recovery phrase with the input hidden, so
// it never lands in shell history. The coins are Mutinynet coins: valueless
// test coins, worth nothing on mainnet, which is the only reason a phrase may
// be typed into a terminal at all. Never reuse this phrase for anything else.
import { createInterface } from 'node:readline';
import {
  PracticeEsploraClient,
  PracticeKeyring,
  generatePracticeMnemonic,
  maxPracticeSendable,
  planPracticeTransaction,
  reviewPracticeTransaction,
  signPracticeTransaction,
} from '@alice-wallet/practice-wallet';

/** Kept in step with TEST_WALLET_FAUCET_SATS in the Worker. */
const PAYOUT_SATS = 2_100;

/** Kept in step with SCAN_DEPTH in the Worker: it spends only these coins. */
const SCAN_DEPTH = 20;

const command = (process.argv[2] ?? '').trim();

function sats(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Reads the recovery phrase without echoing it.
 *
 * This is the only prompt any command may ever ask. An earlier version hid
 * the phrase by erasing the line on each keystroke and then asked a second
 * question through a second readline; the terminal re-echoed the buffered
 * phrase into that second prompt, which printed the live faucet phrase in
 * plain sight and answered the prompt with it. Everything else a command
 * needs is therefore taken from the command line, never from stdin.
 *
 * Muting the interface itself, rather than repainting over the echo, means
 * there is nothing to leak in the first place.
 */
function askHidden(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const answer = new Promise(resolve => {
    rl.question(question, value => {
      rl.close();
      process.stdout.write('\n');
      resolve(value.trim());
    });
  });
  // Set after the question is written, so the question shows and nothing else.
  rl._writeToOutput = () => {};
  return answer;
}

if (command === 'new') {
  const mnemonic = generatePracticeMnemonic();
  const keyring = new PracticeKeyring(mnemonic);
  const funding = keyring.addressAt(false, 0).address;

  console.log('\nAlice test wallet faucet: new dispensing wallet');
  console.log('Mutinynet only. These coins have no value; this phrase must never hold real bitcoin.\n');
  console.log('Recovery phrase (the Worker secret):\n');
  console.log('  ' + mnemonic + '\n');
  console.log('Funding address (m/84\'/1\'/0\'/0/0):\n');
  console.log('  ' + funding + '\n');
  console.log('Next:');
  console.log('  1. Fund that address at https://faucet.mutinynet.com. One payout serves');
  console.log(`     ${Math.floor(1_000_000 / PAYOUT_SATS)} learners per million sats.`);
  console.log('  2. Store the phrase where Alice keeps its other Worker secrets, then:');
  console.log('       cd apps/venice-proxy-worker && npx wrangler secret put TEST_WALLET_FAUCET_MNEMONIC');
  console.log('  3. Clear this terminal so the phrase leaves the scrollback.\n');
  process.exit(0);
}

/** Every coin the dispensing wallet can spend, as the Worker gathers them. */
async function collectCoins(keyring, client) {
  const coins = [];
  for (const change of [false, true]) {
    for (let index = 0; index < SCAN_DEPTH; index += 1) {
      const { address } = keyring.addressAt(change, index);
      for (const utxo of await client.getAddressUtxos(address)) {
        coins.push({ ...utxo, address, change, index });
      }
    }
  }
  return coins;
}

if (command === 'balance') {
  const mnemonic = await askHidden('Faucet recovery phrase (hidden): ');
  const keyring = new PracticeKeyring(mnemonic);
  const client = new PracticeEsploraClient();

  const utxos = await collectCoins(keyring, client);
  const coins = utxos.length;
  const total = utxos.reduce((sum, utxo) => sum + utxo.valueSats, 0);
  const pending = utxos.filter(utxo => !utxo.confirmed)
    .reduce((sum, utxo) => sum + utxo.valueSats, 0);

  const spendable = total - pending;
  console.log('');
  console.log(`Float:     ${sats(total)} sats in ${coins} coin${coins === 1 ? '' : 's'}`);
  if (pending > 0) console.log(`Pending:   ${sats(pending)} sats not yet confirmed`);
  console.log(`Payouts:   about ${Math.floor(spendable / (PAYOUT_SATS + 200))} left at ${sats(PAYOUT_SATS)} sats plus fee`);
  console.log(`Top up:    ${keyring.addressAt(false, 0).address}`);
  console.log('');
  process.exit(0);
}

// What the admin console needs to show the float: an account public key. It
// derives the same addresses as the phrase and can do nothing else, so the
// console reads the reserve without ever holding the means to move it.
if (command === 'xpub') {
  const mnemonic = await askHidden('Faucet recovery phrase (hidden): ');
  const keyring = new PracticeKeyring(mnemonic);
  console.log('');
  console.log('Watch-only account key. It cannot spend; it only derives addresses.');
  console.log('');
  console.log('  ' + keyring.accountXpub());
  console.log('');
  console.log('Put it in apps/venice-proxy-worker/.dev.vars as:');
  console.log('');
  console.log('  TEST_WALLET_FAUCET_XPUB=<the key above>');
  console.log('');
  console.log('and remove any TEST_WALLET_FAUCET_MNEMONIC line from that file:');
  console.log('the console never needs the phrase, only the Worker does.');
  console.log('');
  process.exit(0);
}

// A payout by hand: topping up a test wallet, refunding a learner whose claim
// went wrong, or emptying the float into a fresh dispensing wallet. It goes
// around the Worker entirely, so neither the daily cap nor the once-per-learner
// rule applies. Without --yes it builds the whole transaction and stops, which
// is the dry run: the same command with the flag is what actually sends.
if (command === 'send') {
  const recipient = (process.argv[3] ?? '').trim();
  const requested = (process.argv[4] ?? '').trim();
  const sweeping = requested === 'max';
  const confirmed = process.argv.includes('--yes');
  if (!recipient || (!sweeping && !(Number.isInteger(Number(requested)) && Number(requested) > 0))) {
    console.error('Usage: node scripts/test-wallet-faucet.mjs send <tb1-address> <sats|max> [--yes]');
    console.error('Without --yes it shows the transaction and stops.');
    process.exit(1);
  }

  const mnemonic = await askHidden('Faucet recovery phrase (hidden): ');
  const keyring = new PracticeKeyring(mnemonic);
  const client = new PracticeEsploraClient();

  const utxos = await collectCoins(keyring, client);
  if (utxos.length === 0) {
    console.error('\nThe dispensing wallet holds no coins. Fund it first.\n');
    process.exit(1);
  }

  const feeRateSatVb = await client.recommendedFeeRate(2);
  // `max` empties the float into one output, which is how a compromised
  // dispensing wallet is retired into a fresh one.
  const amountSats = sweeping
    ? maxPracticeSendable({ utxos, feeRateSatVb }).amountSats
    : Number(requested);

  // Change returns to the chain the Worker already scans, so a manual payout
  // never strands the float outside the faucet's reach.
  const plan = planPracticeTransaction({
    utxos,
    recipientAddress: recipient,
    amountSats,
    feeRateSatVb,
    changeAddress: keyring.addressAt(true, 0).address,
  });
  const signed = signPracticeTransaction(plan, keyring);
  const review = reviewPracticeTransaction(signed.txHex, plan);
  if (!review.matchesPlan) {
    console.error('\nThe signed bytes do not match the plan, nothing was broadcast:');
    for (const issue of review.issues) console.error('  ' + issue);
    process.exit(1);
  }

  console.log('');
  console.log(`Spending:  ${sats(plan.totalInputSats)} sats from ${plan.inputs.length} coin${plan.inputs.length === 1 ? '' : 's'}`);
  console.log(`To:        ${sats(plan.amountSats)} sats to ${recipient}`);
  console.log(`Change:    ${sats(plan.changeSats)} sats back to the faucet`);
  console.log(`Fee:       ${sats(plan.feeSats)} sats at ${plan.feeRateSatVb} sat/vB`);
  console.log(`Txid:      ${signed.txid}`);
  console.log('');

  if (!confirmed) {
    console.log('Nothing was broadcast. Add --yes to the same command to send it.\n');
    process.exit(0);
  }

  const txid = await client.broadcastTx(signed.txHex);
  console.log(`\nSent. https://mutinynet.com/tx/${txid}\n`);
  process.exit(0);
}

console.error('Usage: node scripts/test-wallet-faucet.mjs <new|balance|xpub|send>');
process.exit(1);
