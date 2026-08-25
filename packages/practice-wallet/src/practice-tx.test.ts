import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PracticeKeyring } from './practice-keys.ts';
import {
  PRACTICE_DUST_SATS,
  estimatePracticeVbytes,
  maxPracticeSendable,
  planPracticeTransaction,
  reviewPracticeTransaction,
  signPracticeTransaction,
  type PracticeUtxo,
} from './practice-tx.ts';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const keyring = new PracticeKeyring(TEST_MNEMONIC);
const recipient = keyring.addressAt(false, 5).address;
const changeAddress = keyring.addressAt(true, 0).address;

function utxo(overrides: Partial<PracticeUtxo>): PracticeUtxo {
  return {
    txid: 'aa'.repeat(32),
    vout: 0,
    valueSats: 60_000,
    address: keyring.addressAt(false, 0).address,
    change: false,
    index: 0,
    confirmed: true,
    ...overrides,
  };
}

test('plans a simple payment with a change output', () => {
  const plan = planPracticeTransaction({
    utxos: [utxo({})],
    recipientAddress: recipient,
    amountSats: 40_000,
    feeRateSatVb: 2,
    changeAddress,
  });
  assert.equal(plan.inputs.length, 1);
  assert.equal(plan.estimatedVbytes, estimatePracticeVbytes(1, 2));
  assert.equal(plan.feeSats, estimatePracticeVbytes(1, 2) * 2);
  assert.deepEqual(plan.outputs, [
    { address: recipient, valueSats: 40_000, kind: 'recipient' },
    { address: changeAddress, valueSats: 60_000 - 40_000 - plan.feeSats, kind: 'change' },
  ]);
  assert.equal(plan.totalInputSats, plan.amountSats + plan.changeSats + plan.feeSats);
});

test('drops a dust change output into the fee', () => {
  const plan = planPracticeTransaction({
    utxos: [utxo({})],
    recipientAddress: recipient,
    amountSats: 59_400,
    feeRateSatVb: 1,
    changeAddress,
  });
  assert.equal(plan.outputs.length, 1);
  assert.equal(plan.changeSats, 0);
  assert.equal(plan.feeSats, 600);
});

test('accumulates several coins when one is not enough', () => {
  const plan = planPracticeTransaction({
    utxos: [utxo({}), utxo({ txid: 'bb'.repeat(32), valueSats: 30_000, index: 1 })],
    recipientAddress: recipient,
    amountSats: 80_000,
    feeRateSatVb: 1,
    changeAddress,
  });
  assert.equal(plan.inputs.length, 2);
  assert.equal(plan.totalInputSats, 90_000);
  assert.equal(plan.feeSats, estimatePracticeVbytes(2, 2));
  assert.equal(plan.changeSats, 90_000 - 80_000 - plan.feeSats);
});

test('prefers confirmed coins over larger unconfirmed ones', () => {
  const plan = planPracticeTransaction({
    utxos: [
      utxo({ txid: 'cc'.repeat(32), valueSats: 100_000, confirmed: false }),
      utxo({ valueSats: 20_000 }),
    ],
    recipientAddress: recipient,
    amountSats: 10_000,
    feeRateSatVb: 1,
    changeAddress,
  });
  assert.equal(plan.inputs.length, 1);
  assert.equal(plan.inputs[0].valueSats, 20_000);
  assert.equal(plan.inputs[0].confirmed, true);
});

test('rejects insufficient funds, bad amounts and foreign addresses', () => {
  assert.throws(
    () =>
      planPracticeTransaction({
        utxos: [utxo({})],
        recipientAddress: recipient,
        amountSats: 100_000,
        feeRateSatVb: 1,
        changeAddress,
      }),
    /Insufficient practice funds: 60000 sats available/,
  );
  assert.throws(
    () =>
      planPracticeTransaction({
        utxos: [utxo({})],
        recipientAddress: recipient,
        amountSats: PRACTICE_DUST_SATS - 1,
        feeRateSatVb: 1,
        changeAddress,
      }),
    /at least 546 sats/,
  );
  // Valid mainnet address, wrong network for the practice wallet.
  assert.throws(
    () =>
      planPracticeTransaction({
        utxos: [utxo({})],
        recipientAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        amountSats: 10_000,
        feeRateSatVb: 1,
        changeAddress,
      }),
    /not a valid Mutinynet address/,
  );
});

test('signs the plan and the review confirms the actual bytes', () => {
  const plan = planPracticeTransaction({
    utxos: [utxo({}), utxo({ txid: 'bb'.repeat(32), valueSats: 30_000, index: 1 })],
    recipientAddress: recipient,
    amountSats: 80_000,
    feeRateSatVb: 1,
    changeAddress,
  });
  const signed = signPracticeTransaction(plan, keyring);
  assert.match(signed.txid, /^[0-9a-f]{64}$/);
  assert.match(signed.txHex, /^[0-9a-f]+$/);
  // The vsize model is an upper bound and must stay within 2 vbytes per input.
  assert.ok(signed.vsizeVbytes <= plan.estimatedVbytes);
  assert.ok(plan.estimatedVbytes - signed.vsizeVbytes <= 2 * plan.inputs.length);

  const review = reviewPracticeTransaction(signed.txHex, plan);
  assert.equal(review.matchesPlan, true, review.issues.join(' | '));
  assert.deepEqual(review.issues, []);
  assert.equal(review.txid, signed.txid);
  assert.equal(review.feeSats, plan.feeSats);
  assert.deepEqual(
    review.outputs.map((output) => output.kind).sort(),
    ['change', 'recipient'],
  );
});

test('the review flags a transaction that does not match the plan', () => {
  const plan = planPracticeTransaction({
    utxos: [utxo({})],
    recipientAddress: recipient,
    amountSats: 40_000,
    feeRateSatVb: 2,
    changeAddress,
  });
  const signed = signPracticeTransaction(plan, keyring);

  const tamperedPlan = { ...plan, amountSats: 41_000 };
  const review = reviewPracticeTransaction(signed.txHex, tamperedPlan);
  assert.equal(review.matchesPlan, false);
  assert.ok(review.issues.some((issue) => issue.includes('41000')));
});

test('the maximum sendable amount can actually be sent', () => {
  // The bug this guards: "send everything" cannot mean the balance, because
  // the fee comes out of the same coins. The amount computed here must plan,
  // sign and verify without a single sat left over.
  const utxos = [utxo({ valueSats: 2_100 }), utxo({ vout: 1, valueSats: 7_400, index: 1 })];
  const max = maxPracticeSendable({ utxos, feeRateSatVb: 2 });
  assert.equal(max.inputCount, 2);
  assert.equal(max.feeSats, estimatePracticeVbytes(2, 1) * 2);
  assert.equal(max.amountSats, 9_500 - max.feeSats);

  const plan = planPracticeTransaction({
    utxos,
    recipientAddress: recipient,
    amountSats: max.amountSats,
    feeRateSatVb: 2,
    changeAddress,
  });
  assert.equal(plan.inputs.length, 2, 'a sweep spends every coin');
  assert.equal(plan.changeSats, 0, 'a sweep leaves no change behind');
  assert.equal(plan.outputs.length, 1);
  assert.equal(plan.feeSats, max.feeSats, 'the fee is the one that was quoted');
  assert.equal(plan.amountSats + plan.feeSats, 9_500, 'the coins are emptied exactly');

  const review = reviewPracticeTransaction(signPracticeTransaction(plan, keyring).txHex, plan);
  assert.equal(review.matchesPlan, true, review.issues.join(' | '));
});

test('a single small coin still sweeps, at a smaller fee than two', () => {
  const one = maxPracticeSendable({ utxos: [utxo({ valueSats: 2_100 })], feeRateSatVb: 2 });
  assert.equal(one.feeSats, estimatePracticeVbytes(1, 1) * 2);
  assert.equal(one.amountSats, 2_100 - one.feeSats);
  assert.ok(one.amountSats > PRACTICE_DUST_SATS);
});

test('coins worth less than their own fee sweep to nothing rather than a negative', () => {
  const max = maxPracticeSendable({ utxos: [utxo({ valueSats: 10 })], feeRateSatVb: 50 });
  assert.equal(max.amountSats, 0);
  assert.equal(maxPracticeSendable({ utxos: [], feeRateSatVb: 2 }).amountSats, 0);
});

// A learner paying a tb1p address is the case the old model got wrong: it
// charged every output the price of a p2wpkh one, so the transaction paid for
// 12 vbytes it did not have, and at 1 sat/vB the network refused it.
const taproot = 'tb1p4hfgu2jdcjm8lcvx2hx83pnn9r734zmjm8ee6v2g654hs0agsqwq3z0mud';

test('a taproot output is charged its real size, not a p2wpkh one', () => {
  const plan = planPracticeTransaction({
    utxos: [utxo({})],
    recipientAddress: taproot,
    amountSats: 10_000,
    feeRateSatVb: 1,
    changeAddress,
  });
  const signed = signPracticeTransaction(plan, keyring);
  assert.equal(plan.estimatedVbytes, signed.vsizeVbytes, 'the estimate must match the signed bytes');
  assert.ok(
    plan.feeSats / signed.vsizeVbytes >= 1,
    `paid ${plan.feeSats / signed.vsizeVbytes} sat/vB, below the minimum the network relays`,
  );
  assert.equal(reviewPracticeTransaction(signed.txHex, plan).matchesPlan, true);
});

test('sweeping to a taproot address empties the wallet exactly', () => {
  const utxos = [utxo({ valueSats: 2_100 }), utxo({ vout: 1, valueSats: 7_400, index: 1 })];
  const max = maxPracticeSendable({ utxos, feeRateSatVb: 1, recipientAddress: taproot });
  const plan = planPracticeTransaction({
    utxos, recipientAddress: taproot, amountSats: max.amountSats, feeRateSatVb: 1, changeAddress,
  });
  const signed = signPracticeTransaction(plan, keyring);
  assert.equal(plan.changeSats, 0);
  assert.equal(plan.feeDonationSats, 0, 'a sweep pays for bytes, it donates nothing');
  assert.equal(plan.amountSats + plan.feeSats, 9_500);
  assert.ok(plan.feeSats / signed.vsizeVbytes >= 1);
});

test('the fee donation is what a leftover too small for an output becomes', () => {
  // 40 000 to send out of 40 400: the 400 left cannot be an output, so it
  // joins the fee instead of buying any bytes.
  const plan = planPracticeTransaction({
    utxos: [utxo({ valueSats: 40_400 })],
    recipientAddress: recipient,
    amountSats: 40_000,
    feeRateSatVb: 1,
    changeAddress,
  });
  assert.equal(plan.changeSats, 0);
  assert.equal(plan.feeSats, 400);
  assert.equal(plan.feeDonationSats, 400 - plan.estimatedVbytes);
});
