import { Address, OutScript, TEST_NETWORK, Transaction } from '@scure/btc-signer';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { PracticeKeyring } from './practice-keys.ts';

/**
 * Transaction building for the Mutinynet practice wallet.
 *
 * The flow is deliberately split into named, inspectable steps so the app can
 * walk a beginner through each one:
 *
 *   1. planPracticeTransaction, pick coins, compute fee and change (pure)
 *   2. signPracticeTransaction, build and sign the transaction
 *   3. reviewPracticeTransaction, re-decode the raw bytes and check them
 *      against the plan ("don't trust, verify")
 *
 * Broadcasting is the caller's job via PracticeEsploraClient.broadcastTx.
 */

/** Below this, a change output costs more to spend than it is worth. */
export const PRACTICE_DUST_SATS = 546;

// Virtual-size model. Inputs are always this wallet's own p2wpkh coins, so
// they have one size. Outputs do not: the wallet pays whatever address it is
// given, and a taproot output is 12 vbytes larger than a p2wpkh one. Charging
// every output the p2wpkh price underprices a payment to a tb1p address, and
// at 1 sat/vB the network rejects the result for paying below the minimum
// relay fee. So outputs are measured, not assumed.
const TX_OVERHEAD_VBYTES = 11;
const INPUT_VBYTES = 68;
const OUTPUT_VBYTES = 31;

/** value (8) + script length (1) + the script this address actually encodes. */
function outputVbytesFor(address: string): number {
  try {
    return 9 + OutScript.encode(Address(TEST_NETWORK).decode(address)).length;
  } catch {
    // Not decodable: the planner rejects it moments later with a readable
    // message, and an estimate is not the place to throw.
    return OUTPUT_VBYTES;
  }
}

export type PracticeUtxo = {
  txid: string;
  vout: number;
  valueSats: number;
  address: string;
  change: boolean;
  index: number;
  confirmed: boolean;
};

export type PracticeTxOutput = {
  address: string;
  valueSats: number;
  kind: 'recipient' | 'change';
};

export type PracticeTxPlan = {
  inputs: PracticeUtxo[];
  outputs: PracticeTxOutput[];
  recipientAddress: string;
  amountSats: number;
  changeSats: number;
  feeSats: number;
  /**
   * The part of the fee that is not buying size: a leftover too small to be
   * worth its own output, handed to the miners instead. Zero whenever the
   * transaction pays exactly what its bytes cost, which is what a sweep does.
   */
  feeDonationSats: number;
  feeRateSatVb: number;
  estimatedVbytes: number;
  totalInputSats: number;
};

export type PracticeTxReview = {
  txid: string;
  outputs: PracticeTxOutput[];
  feeSats: number;
  matchesPlan: boolean;
  issues: string[];
};

/**
 * Size of a transaction spending `inputCount` of this wallet's coins into the
 * given outputs. Passing a count instead of addresses prices every output as
 * p2wpkh, which is right for this wallet's own change and wrong for anything
 * else; the planner always passes addresses.
 */
export function estimatePracticeVbytes(
  inputCount: number,
  outputs: number | string[],
): number {
  const outputVbytes = typeof outputs === 'number'
    ? outputs * OUTPUT_VBYTES
    : outputs.reduce((sum, address) => sum + outputVbytesFor(address), 0);
  return TX_OVERHEAD_VBYTES + inputCount * INPUT_VBYTES + outputVbytes;
}

function assertPracticeAddress(address: string, label: string): void {
  try {
    Address(TEST_NETWORK).decode(address);
  } catch {
    throw new Error(
      `${label} is not a valid Mutinynet address. Practice addresses start with tb1.`,
    );
  }
}

function feeFor(
  inputCount: number,
  outputs: number | string[],
  feeRateSatVb: number,
): number {
  return Math.ceil(estimatePracticeVbytes(inputCount, outputs) * feeRateSatVb);
}

/**
 * The largest amount these coins can actually pay out: everything they hold,
 * minus the fee for spending all of them into a single output.
 *
 * Emptying a wallet is not "send the balance": the fee has to come out of the
 * same coins, so a sweep pays slightly less than the balance and leaves no
 * change behind. Working that out here, from the same size model the planner
 * uses, is what lets a MAX button mean what it says instead of asking for an
 * amount the wallet can never afford.
 */
export function maxPracticeSendable(params: {
  utxos: PracticeUtxo[];
  feeRateSatVb: number;
  /** Priced as p2wpkh when absent, which is this wallet's own output size. */
  recipientAddress?: string;
}): { amountSats: number; feeSats: number; inputCount: number } {
  const { utxos, feeRateSatVb, recipientAddress } = params;
  if (utxos.length === 0) return { amountSats: 0, feeSats: 0, inputCount: 0 };
  const totalSats = utxos.reduce((sum, utxo) => sum + utxo.valueSats, 0);
  const feeSats = feeFor(utxos.length, recipientAddress ? [recipientAddress] : 1, feeRateSatVb);
  return {
    amountSats: Math.max(0, totalSats - feeSats),
    feeSats,
    inputCount: utxos.length,
  };
}

export function planPracticeTransaction(params: {
  utxos: PracticeUtxo[];
  recipientAddress: string;
  amountSats: number;
  feeRateSatVb: number;
  changeAddress: string;
}): PracticeTxPlan {
  const { utxos, recipientAddress, amountSats, feeRateSatVb, changeAddress } = params;
  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    throw new Error('The amount to send must be a whole number of sats above zero.');
  }
  if (amountSats < PRACTICE_DUST_SATS) {
    throw new Error(`The amount to send must be at least ${PRACTICE_DUST_SATS} sats.`);
  }
  if (!Number.isFinite(feeRateSatVb) || feeRateSatVb < 1) {
    throw new Error('The fee rate must be at least 1 sat/vB.');
  }
  assertPracticeAddress(recipientAddress, 'The recipient address');
  assertPracticeAddress(changeAddress, 'The change address');

  // Measured once: the recipient's script size is whatever they gave us.
  const recipientOnly = [recipientAddress];
  const bothOutputs = [recipientAddress, changeAddress];

  // Confirmed coins first, then largest first, so beginners spend settled
  // funds before unconfirmed ones.
  const candidates = [...utxos].sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
    return b.valueSats - a.valueSats;
  });

  const selected: PracticeUtxo[] = [];
  let totalInputSats = 0;
  for (const utxo of candidates) {
    selected.push(utxo);
    totalInputSats += utxo.valueSats;

    const feeWithChange = feeFor(selected.length, bothOutputs, feeRateSatVb);
    const changeSats = totalInputSats - amountSats - feeWithChange;
    if (changeSats >= PRACTICE_DUST_SATS) {
      return {
        inputs: selected,
        outputs: [
          { address: recipientAddress, valueSats: amountSats, kind: 'recipient' },
          { address: changeAddress, valueSats: changeSats, kind: 'change' },
        ],
        recipientAddress,
        amountSats,
        changeSats,
        feeSats: feeWithChange,
        feeDonationSats: 0,
        feeRateSatVb,
        estimatedVbytes: estimatePracticeVbytes(selected.length, bothOutputs),
        totalInputSats,
      };
    }

    const feeWithoutChange = feeFor(selected.length, recipientOnly, feeRateSatVb);
    if (totalInputSats >= amountSats + feeWithoutChange) {
      // Too small for a change output: the remainder goes to the miners.
      return {
        inputs: selected,
        outputs: [{ address: recipientAddress, valueSats: amountSats, kind: 'recipient' }],
        recipientAddress,
        amountSats,
        changeSats: 0,
        feeSats: totalInputSats - amountSats,
        feeDonationSats: totalInputSats - amountSats - feeWithoutChange,
        feeRateSatVb,
        estimatedVbytes: estimatePracticeVbytes(selected.length, recipientOnly),
        totalInputSats,
      };
    }
  }

  const available = candidates.reduce((sum, utxo) => sum + utxo.valueSats, 0);
  throw new Error(
    `Insufficient practice funds: ${available} sats available, ` +
      `${amountSats} sats plus fees needed.`,
  );
}

export function signPracticeTransaction(
  plan: PracticeTxPlan,
  keyring: PracticeKeyring,
): { txHex: string; txid: string; vsizeVbytes: number } {
  const tx = new Transaction();
  for (const input of plan.inputs) {
    tx.addInput({
      txid: input.txid,
      index: input.vout,
      witnessUtxo: {
        script: keyring.scriptAt(input.change, input.index),
        amount: BigInt(input.valueSats),
      },
    });
  }
  for (const output of plan.outputs) {
    tx.addOutputAddress(output.address, BigInt(output.valueSats), TEST_NETWORK);
  }

  const signedPaths = new Set<string>();
  for (const input of plan.inputs) {
    const path = `${input.change ? 1 : 0}/${input.index}`;
    if (signedPaths.has(path)) continue;
    signedPaths.add(path);
    tx.sign(keyring.privateKeyAt(input.change, input.index));
  }
  tx.finalize();

  return { txHex: tx.hex, txid: tx.id, vsizeVbytes: tx.vsize };
}

/**
 * Independently re-decodes the signed raw transaction and checks it against
 * the plan. This backs the "verify before broadcasting" step of the guided
 * flow: what is checked is the actual bytes, not the in-memory objects.
 */
export function reviewPracticeTransaction(txHex: string, plan: PracticeTxPlan): PracticeTxReview {
  const tx = Transaction.fromRaw(hexToBytes(txHex), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
  });
  const issues: string[] = [];

  const plannedOutpoints = new Set(plan.inputs.map((input) => `${input.txid}:${input.vout}`));
  const actualOutpoints = new Set<string>();
  for (let i = 0; i < tx.inputsLength; i += 1) {
    const input = tx.getInput(i);
    if (!input.txid || input.index === undefined) {
      issues.push(`Input ${i} could not be decoded.`);
      continue;
    }
    actualOutpoints.add(`${bytesToHex(input.txid)}:${input.index}`);
  }
  if (
    actualOutpoints.size !== plannedOutpoints.size ||
    [...actualOutpoints].some((outpoint) => !plannedOutpoints.has(outpoint))
  ) {
    issues.push('The signed transaction does not spend the planned coins.');
  }

  const outputs: PracticeTxOutput[] = [];
  let totalOutputSats = 0;
  for (let i = 0; i < tx.outputsLength; i += 1) {
    const output = tx.getOutput(i);
    if (!output.script || output.amount === undefined) {
      issues.push(`Output ${i} could not be decoded.`);
      continue;
    }
    const valueSats = Number(output.amount);
    totalOutputSats += valueSats;
    let address: string;
    try {
      address = Address(TEST_NETWORK).encode(OutScript.decode(output.script));
    } catch {
      issues.push(`Output ${i} pays to a script this wallet cannot decode.`);
      continue;
    }
    const planned = plan.outputs.find(
      (candidate) => candidate.address === address && candidate.valueSats === valueSats,
    );
    outputs.push({ address, valueSats, kind: planned?.kind ?? 'recipient' });
  }

  const recipientOk = outputs.some(
    (output) => output.address === plan.recipientAddress && output.valueSats === plan.amountSats,
  );
  if (!recipientOk) {
    issues.push(
      `No output pays ${plan.amountSats} sats to the planned recipient ${plan.recipientAddress}.`,
    );
  }
  if (outputs.length !== plan.outputs.length) {
    issues.push(
      `The transaction has ${outputs.length} decoded outputs, the plan expected ${plan.outputs.length}.`,
    );
  }

  const feeSats = plan.totalInputSats - totalOutputSats;
  if (feeSats !== plan.feeSats) {
    issues.push(`The actual fee is ${feeSats} sats, the plan expected ${plan.feeSats} sats.`);
  }

  return { txid: tx.id, outputs, feeSats, matchesPlan: issues.length === 0, issues };
}
