// Transaction privacy heuristics: what a chain analyst can infer from a single
// transaction, run defensively so the user sees their own leaks.
//
// Ported from am-i-exposed (https://github.com/Copexit/am-i-exposed),
// src/lib/analysis/heuristics/ (change-detection, change-detection-signals,
// round-amount, bip69), (c) 2026 Copexit, MIT licensed. Adapted to Explorer's
// NormalizedTransaction and PrivacySignal model; their 0-100 scoring is dropped
// on purpose (the contract forbids a single score presented as scientific).

import type { PrivacySignal, RuleId, SignalConfidence, SignalSeverity } from './signals.ts';
import type { NormalizedInput, NormalizedOutput, NormalizedTransaction } from './types.ts';
import { transactionEntropy } from './boltzmann.ts';

const SATS_PER_BTC = 100_000_000;
const ROUND_BTC_SATS = new Set(
  [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10].map(b => b * SATS_PER_BTC),
);
const ROUND_SAT_MULTIPLES = [10_000, 100_000, 1_000_000, 10_000_000];

/** A payment amount rarely round: a round output is almost certainly the payment. */
export function isRoundAmount(sats: number): boolean {
  if (ROUND_BTC_SATS.has(sats)) return true;
  return ROUND_SAT_MULTIPLES.some(m => sats >= m && sats % m === 0);
}

/** Outputs that pay an address (drop OP_RETURN and value-less carriers). */
function spendable(outputs: readonly NormalizedOutput[]): NormalizedOutput[] {
  return outputs.filter(o => o.address && o.valueSats > 0 && o.scriptType !== 'op_return');
}

function sig(
  ruleId: RuleId,
  address: string,
  severity: SignalSeverity,
  confidence: SignalConfidence,
  title: string,
  detail: string,
  evidence: Record<string, string | number | boolean>,
): PrivacySignal {
  return { id: `${ruleId}:${address}`, ruleId, severity, confidence, title, detail, subjects: [address], evidence };
}

/**
 * CHANGE_DETECTION. Identify the change output, which reveals the payment amount
 * and recipient. Deterministic when an output returns to an input address; else a
 * weighted vote over sub-heuristics (address-type match, round amount, value
 * disparity, unnecessary input) on the common two-output case.
 */
export function detectChangeDetection(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase) return [];
  const outs = spendable(tx.outputs);
  const inAddrs = new Set(tx.inputs.map(i => i.address).filter((a): a is string => !!a));
  const subject = tx.txid;

  // Deterministic: an output returns to an address that was also an input.
  if (inAddrs.size > 0 && outs.length > 0) {
    const matching = outs.filter(o => inAddrs.has(o.address!));
    if (matching.length > 0) {
      const allMatch = matching.length === outs.length;
      const consolidation = allMatch && outs.length === 1;
      return [sig(
        'CHANGE_DETECTION', subject,
        consolidation ? 'medium' : 'high', 'certain',
        consolidation ? 'Self-transfer to an input address' : 'Change revealed by a reused address',
        consolidation
          ? 'Funds return to an address that was also an input, confirming ownership and linking the inputs.'
          : `${matching.length} of ${outs.length} outputs go back to an input address. That output is certainly change, which reveals the payment amount and recipient.`,
        { deterministic: true, selfSend: true, matchCount: matching.length, outputCount: outs.length, inputCount: tx.inputs.length },
      )];
    }
  }

  // The weighted vote only applies to the classic two-output payment.
  if (outs.length !== 2) return [];
  const [a, b] = outs;
  const votes = [0, 0];
  const reasons: string[] = [];
  let hasRound = false;
  const vote = (idx: number, weight: number, why: string) => { votes[idx] += weight; reasons.push(why); };

  // Address-type match: change usually keeps the input script type.
  const inTypes = new Set(tx.inputs.map(i => i.scriptType).filter(Boolean));
  if (inTypes.size === 1) {
    const t = [...inTypes][0];
    if (a.scriptType === t && b.scriptType !== t) vote(0, 2, 'change matches the input address type');
    else if (b.scriptType === t && a.scriptType !== t) vote(1, 2, 'change matches the input address type');
  }
  // Round amount: the non-round output is likely change.
  const ra = isRoundAmount(a.valueSats), rb = isRoundAmount(b.valueSats);
  if (ra !== rb) { hasRound = true; vote(ra ? 1 : 0, 1, 'the non-round output is likely change'); }
  // Value disparity: a 100x-larger output is likely the sender's remaining funds.
  const ratio = Math.max(a.valueSats, b.valueSats) / Math.max(1, Math.min(a.valueSats, b.valueSats));
  if (ratio >= 100) vote(a.valueSats > b.valueSats ? 0 : 1, 1, 'a large value disparity between outputs');
  // Unnecessary input: if one input alone could fund an output (plus fee), the
  // extra inputs reveal the other as change.
  if (tx.inputs.length >= 2 && tx.feeSats != null) {
    const largest = Math.max(0, ...tx.inputs.map(i => i.valueSats ?? 0));
    const aFund = a.valueSats + tx.feeSats <= largest;
    const bFund = b.valueSats + tx.feeSats <= largest;
    if (aFund && !bFund) vote(1, 1, 'unnecessary inputs suggest change');
    else if (bFund && !aFund) vote(0, 1, 'unnecessary inputs suggest change');
  }

  const max = Math.max(votes[0], votes[1]);
  if (max === 0) return [];
  const total = votes[0] + votes[1];
  const majority = total > 0 ? max / total : 1;
  const dissent = votes[0] > 0 && votes[1] > 0;
  const confidence: SignalConfidence = max >= 3 && majority >= 3 / 4 ? 'strong' : max >= 2 && majority >= 2 / 3 ? 'strong' : 'possible';
  const severity: SignalSeverity = confidence === 'strong' ? (hasRound ? 'high' : 'medium') : 'low';

  return [sig(
    'CHANGE_DETECTION', subject, severity, confidence,
    'Change output likely identifiable',
    `${reasons.length} signal${reasons.length > 1 ? 's' : ''} point to a change output: ${reasons.join('; ')}.` +
    (dissent ? ' Not all signals agree, which lowers certainty.' : '') +
    ' When change is known, the exact payment amount and recipient are revealed.',
    { deterministic: false, selfSend: false, roundAmount: hasRound, dissent, signalCount: reasons.length, inputCount: tx.inputs.length, outputCount: outs.length },
  )];
}

/** BIP69: inputs sorted by (txid, vout), outputs by (value, then a tiebreak). */
function isBip69Ordered(inputs: readonly NormalizedInput[], outputs: readonly NormalizedOutput[]): boolean {
  for (let i = 1; i < inputs.length; i++) {
    const p = inputs[i - 1], c = inputs[i];
    if (p.prevTxid > c.prevTxid) return false;
    if (p.prevTxid === c.prevTxid && p.prevVout > c.prevVout) return false;
  }
  for (let i = 1; i < outputs.length; i++) {
    if (outputs[i - 1].valueSats > outputs[i].valueSats) return false;
  }
  return true;
}

/**
 * WALLET_FINGERPRINT. BIP69 lexicographic ordering was meant to reduce
 * fingerprinting but instead identifies specific software (Electrum, older
 * Samourai/Ashigaru); most wallets order randomly.
 */
export function detectWalletFingerprint(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase) return [];
  if (tx.inputs.length < 2 || spendable(tx.outputs).length < 2) return [];
  if (!isBip69Ordered(tx.inputs, tx.outputs)) return [];
  return [sig(
    'WALLET_FINGERPRINT', tx.txid, 'low', 'possible',
    'Wallet software fingerprint (BIP69)',
    'The inputs and outputs follow BIP69 lexicographic ordering, which identifies specific wallet software rather than hiding it. A wallet that orders randomly leaks less.',
    { bip69: true, inputCount: tx.inputs.length, outputCount: tx.outputs.length },
  )];
}

/** Script types (as strings) present on the inputs and on the spendable outputs. */
function scriptTypeStr(v: NormalizedInput | NormalizedOutput): string | undefined {
  return v.scriptType ? String(v.scriptType) : undefined;
}

/**
 * SCRIPT_TYPE_MIX. Bare multisig outputs publish every key; mixing script types
 * makes change detection easier and fingerprints the wallet; a single uniform
 * type is the good case.
 */
export function detectScriptTypeMix(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase) return [];
  const outs = spendable(tx.outputs);
  const signals: PrivacySignal[] = [];

  const multisig = tx.outputs.filter(o => scriptTypeStr(o) === 'multisig' || scriptTypeStr(o) === 'p2ms');
  if (multisig.length > 0) {
    signals.push(sig(
      'SCRIPT_TYPE_MIX', tx.txid, 'high', 'certain',
      'Bare multisig output',
      'A bare multisig output exposes every public key directly on-chain, making the signers trivial to identify. P2WSH or Taproot multisig looks like single-sig instead.',
      { multisig: true, outputCount: outs.length, inputCount: tx.inputs.length },
    ));
  }
  if (outs.length < 2) return signals;

  const types = new Set<string>();
  for (const i of tx.inputs) { const t = scriptTypeStr(i); if (t) types.add(t); }
  for (const o of outs) { const t = scriptTypeStr(o); if (t) types.add(t); }

  if (types.size === 1) {
    signals.push(sig(
      'SCRIPT_TYPE_MIX', tx.txid, 'info', 'certain',
      'Uniform script types',
      'Every input and output uses the same script type, so an observer cannot use a type mismatch to pick out the change. This is the good case.',
      { uniform: true, outputCount: outs.length, inputCount: tx.inputs.length },
    ));
  } else if (types.size >= 2) {
    signals.push(sig(
      'SCRIPT_TYPE_MIX', tx.txid, types.size >= 3 ? 'medium' : 'low', 'certain',
      'Mixed script types',
      `This transaction mixes ${types.size} script types, which makes change detection easier and can fingerprint the wallet software.`,
      { mixed: true, typeCount: types.size, outputCount: outs.length, inputCount: tx.inputs.length },
    ));
  }
  return signals;
}

/**
 * ROUND_AMOUNT. Change is rarely a round number, so a round output stands out as
 * the payment, revealing the amount.
 */
export function detectRoundAmount(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase) return [];
  const outs = spendable(tx.outputs);
  if (outs.length < 2) return [];
  const round = outs.filter(o => isRoundAmount(o.valueSats)).length;
  if (round === 0) return [];
  const allRound = round === outs.length;
  return [sig(
    'ROUND_AMOUNT', tx.txid, allRound ? 'low' : round >= 1 ? 'medium' : 'low', allRound ? 'possible' : 'strong',
    allRound ? 'All outputs are round amounts' : 'Round payment amount',
    allRound
      ? 'Every output is a round number, so the payment amount is still identifiable as one of them.'
      : `${round} of ${outs.length} outputs are round numbers, which makes it easy to tell the payment from the change and reveals the amount.`,
    { someRound: !allRound, allRound, roundCount: round, outputCount: outs.length },
  )];
}

/**
 * CONSOLIDATION. Many inputs into one output links the whole UTXO set to one
 * owner (the strongest ownership pattern); mixing script types while doing it
 * adds a clustering signal; one input into many outputs is a batch pattern.
 */
export function detectConsolidation(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase) return [];
  const outs = spendable(tx.outputs);
  const inN = tx.inputs.length;
  const signals: PrivacySignal[] = [];

  if (inN >= 3 && outs.length === 1) {
    signals.push(sig(
      'CONSOLIDATION', tx.txid, inN >= 6 ? 'high' : 'medium', 'strong',
      'Consolidation, many inputs into one',
      `This merges ${inN} separate coins into a single output, permanently linking all those input addresses and exposing the wallet's UTXO set and balance at this point.`,
      { fanIn: true, inputCount: inN, outputCount: 1 },
    ));
    const inTypes = new Set(tx.inputs.map(scriptTypeStr).filter(Boolean));
    if (inTypes.size >= 2) {
      signals.push(sig(
        'CONSOLIDATION', tx.txid, 'high', 'strong',
        'Cross-type consolidation',
        `The consolidation combines ${inTypes.size} different script types, linking addresses from different wallet generations, an extra clustering signal beyond common-input ownership.`,
        { crossType: true, typeCount: inTypes.size, inputCount: inN, outputCount: 1 },
      ));
    }
  }

  if (inN === 1 && outs.length >= 5) {
    signals.push(sig(
      'CONSOLIDATION', tx.txid, 'low', 'possible',
      'Batch payment pattern',
      `One input pays ${outs.length} outputs at once, a batch pattern typical of exchanges or automated spending, which reveals simultaneous payments.`,
      { fanOut: true, inputCount: 1, outputCount: outs.length },
    ));
  }
  return signals;
}

/**
 * COINJOIN. The one positive signal: many equal-value outputs mean a
 * collaborative transaction that breaks the input-output link. Whirlpool uses
 * exactly five equal outputs; other coordinators use three or more.
 */
export function detectCoinjoin(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.inputs.length < 2) return [];
  const outs = spendable(tx.outputs);
  if (outs.length < 2) return [];
  const counts = new Map<number, number>();
  for (const o of outs) counts.set(o.valueSats, (counts.get(o.valueSats) ?? 0) + 1);
  let bestValue = 0, bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) { bestCount = c; bestValue = v; }
  if (bestCount < 3) return [];
  const whirlpool = bestCount === 5;
  return [sig(
    'COINJOIN', tx.txid, 'info', bestCount >= 5 ? 'strong' : 'possible',
    whirlpool ? 'CoinJoin pattern (Whirlpool-style)' : 'CoinJoin pattern',
    `${bestCount} outputs share the same value, the signature of a collaborative CoinJoin. This deliberately breaks the link between inputs and outputs, the one clearly good privacy pattern on-chain. Its benefit depends on careful postmix handling.`,
    { coinjoin: true, whirlpool, equalOutputs: bestCount, inputCount: tx.inputs.length, outputCount: outs.length },
  )];
}

// The most common output value and how many outputs share it (the equal-output
// peak that both CoinJoin and anonymity-set analysis turn on).
function equalOutputPeak(outs: readonly NormalizedOutput[]): { value: number; count: number } {
  const counts = new Map<number, number>();
  for (const o of outs) counts.set(o.valueSats, (counts.get(o.valueSats) ?? 0) + 1);
  let value = 0, count = 0;
  for (const [v, c] of counts) if (c > count) { count = c; value = v; }
  return { value, count };
}

const DUST_GENERAL = 1000;
function dustThreshold(scriptType: string | undefined): number {
  switch (String(scriptType)) {
    case 'p2wpkh': return 294;
    case 'p2wsh': case 'p2tr': return 330;
    default: return 546; // p2pkh, p2sh, unknown: conservative
  }
}

/**
 * CIOH. Multiple distinct input addresses are assumed to share one owner, the
 * foundational clustering technique. Suppressed on a likely CoinJoin, which
 * intentionally breaks the assumption. A single input is the good case.
 */
export function detectCioh(tx: NormalizedTransaction): PrivacySignal[] {
  const spent = tx.inputs.filter(i => !i.isCoinbase);
  if (spent.length === 0) return [];
  const addrs = new Set(spent.map(i => i.address).filter((a): a is string => !!a));
  if (addrs.size === 0) return []; // no prevout addresses to judge
  if (equalOutputPeak(spendable(tx.outputs)).count >= 3 && tx.inputs.length >= 2) return []; // coinjoin, CIOH defeated
  if (addrs.size <= 1) {
    return [sig('CIOH', tx.txid, 'info', 'certain', 'Single input address',
      'This transaction spends from a single address, so the common-input-ownership heuristic does not cluster anything here.',
      { singleInput: true, inputCount: tx.inputs.length })];
  }
  const count = addrs.size;
  const severity: SignalSeverity = count >= 10 ? 'high' : count >= 3 ? 'medium' : 'low';
  return [sig('CIOH', tx.txid, severity, 'strong', `${count} input addresses clustered`,
    `This combines inputs from ${count} different addresses. Chain analysis assumes they belong to one entity, the single most used clustering technique. CoinJoin and PayJoin are what defeat it.`,
    { clustered: true, heavyCluster: count >= 5, inputAddressCount: count, inputCount: tx.inputs.length })];
}

// Whirlpool/Ashigaru pool denominations, in sats, for premix (TX0) detection.
const WHIRLPOOL_DENOMS = [100_000, 1_000_000, 5_000_000, 50_000_000];

/**
 * PREMIX (TX0). A Whirlpool preparatory transaction that splits a coin into
 * equal pool-denomination outputs ready for mixing, plus a coordinator fee and,
 * often, toxic change that must never be spent with the mixed coins. Structural,
 * from the tx alone.
 */
export function detectPremix(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase || tx.inputs.length < 1 || tx.inputs.length > 3) return [];
  const outs = spendable(tx.outputs);
  if (outs.length < 3) return [];
  for (const denom of WHIRLPOOL_DENOMS) {
    const denomOuts = outs.filter(o => o.valueSats === denom);
    if (denomOuts.length < 2) continue;
    const nonDenom = outs.filter(o => o.valueSats !== denom);
    if (nonDenom.length < 1 || nonDenom.length > 2) continue;
    const fee = nonDenom.reduce((s, o) => (o.valueSats < s.valueSats ? o : s), nonDenom[0]);
    if (!(fee.valueSats > 0 && fee.valueSats < denom * 0.5)) continue;
    const toxicChange = nonDenom.length === 2;
    return [sig('PREMIX', tx.txid, toxicChange ? 'low' : 'info', 'strong',
      `CoinJoin premix (${denomOuts.length} outputs)`,
      `This looks like a Whirlpool premix (TX0): ${denomOuts.length} equal outputs prepared for a mixing pool, plus a coordinator fee` +
      (toxicChange ? ', and a toxic change output that must never be spent alongside the mixed coins.' : '.'),
      { premix: true, toxicChange, denomCount: denomOuts.length, inputCount: tx.inputs.length, outputCount: outs.length })];
  }
  return [];
}

/** The classic peel shape: one non-coinbase input and exactly two spendable outputs. */
export function isPeelShape(tx: NormalizedTransaction): boolean {
  if (tx.isCoinbase) return false;
  return tx.inputs.filter(i => !i.isCoinbase).length === 1 && spendable(tx.outputs).length === 2;
}

/**
 * PEEL_CHAIN. A run of peel-shaped transactions, each feeding one output into the
 * next as its sole input, so every payment along the chain is trivially traced.
 * Needs the parent and child context, supplied by the analysis layer.
 */
export function detectPeelChain(
  tx: NormalizedTransaction,
  ctx: { parentPeelLinked: boolean; childPeelLinked: boolean },
): PrivacySignal[] {
  if (!isPeelShape(tx)) return [];
  const depth = 1 + (ctx.parentPeelLinked ? 1 : 0) + (ctx.childPeelLinked ? 1 : 0);
  if (depth < 2) return [];
  return [sig('PEEL_CHAIN', tx.txid, depth >= 3 ? 'high' : 'medium', depth >= 3 ? 'strong' : 'possible',
    `Peel chain (${depth}+ hops)`,
    `This is part of a peel chain: a run of ${depth}+ transactions, each one input to two outputs, where one output feeds the next as its sole input. Following the chain traces every payment.`,
    { peelChain: true, chainDepth: depth, inputCount: tx.inputs.length, outputCount: 2 })];
}

/**
 * DUST_OUTPUT. A tiny output sent in a dusting pattern: attackers seed dust to
 * watch when it is spent and cluster the recipient's addresses.
 */
export function detectDustOutput(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase) return [];
  const dust = tx.outputs.filter(o => o.valueSats > 0 && o.valueSats < DUST_GENERAL && String(o.scriptType) !== 'op_return');
  if (dust.length === 0) return [];
  const attack = (dust.length === 1 && spendable(tx.outputs).length <= 2 && tx.inputs.length === 1)
    || (dust.length >= 5 && dust.length > tx.outputs.length * 0.5);
  if (!attack) return [];
  return [sig('DUST_OUTPUT', tx.txid, 'medium', 'possible', 'Possible dust attack',
    'A tiny amount was sent in a pattern typical of dusting: attackers seed dust to watch when you spend it and link your addresses. If you received it, do not spend it with your other coins.',
    { dustAttack: true, dustCount: dust.length, outputCount: tx.outputs.length, inputCount: tx.inputs.length })];
}

/**
 * DUST_SPENDING. The damaging counterpart: co-spending a dust input with real
 * inputs lets common-input ownership link the dust probe to the whole UTXO set.
 */
export function detectDustSpending(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase || tx.inputs.length < 2) return [];
  let hasDust = false, hasReal = false, dustCount = 0;
  for (const i of tx.inputs) {
    if (i.valueSats == null) continue;
    const th = dustThreshold(i.scriptType ? String(i.scriptType) : undefined);
    if (i.valueSats > 0 && i.valueSats <= th) { hasDust = true; dustCount++; }
    else if (i.valueSats > th) hasReal = true;
  }
  if (!(hasDust && hasReal)) return [];
  return [sig('DUST_SPENDING', tx.txid, 'high', 'certain', 'Dust spent with real coins',
    `A dust input is co-spent with ${tx.inputs.length - dustCount} real input(s). Common-input ownership now ties the dust probe to your whole UTXO set, exactly what the sender of the dust wanted.`,
    { dustSpending: true, dustCount, inputCount: tx.inputs.length })];
}

/**
 * ANONYMITY_SET. Outputs sharing a value are indistinguishable; the size of the
 * largest such group is the anonymity set. Large sets (CoinJoin) are the good
 * case, granular where CoinJoin detection is binary.
 */
export function detectAnonymitySet(tx: NormalizedTransaction): PrivacySignal[] {
  if (tx.isCoinbase) return [];
  const outs = spendable(tx.outputs).filter(o => o.valueSats >= DUST_GENERAL);
  if (outs.length < 2) return [];
  const peak = equalOutputPeak(outs);
  if (peak.count >= 5) {
    return [sig('ANONYMITY_SET', tx.txid, 'info', 'certain', `Anonymity set of ${peak.count}`,
      `${peak.count} outputs share the same value, so an observer cannot tell which input funded which. That is a strong anonymity set, the good case.`,
      { strongAnonset: true, anonsetSize: peak.count, outputCount: outs.length })];
  }
  if (peak.count >= 2) {
    return [sig('ANONYMITY_SET', tx.txid, 'low', 'strong', `Anonymity set of ${peak.count}`,
      `${peak.count} outputs share a value, which gives only limited ambiguity. Larger sets (five or more), as in a CoinJoin, give much more.`,
      { someAnonset: true, anonsetSize: peak.count, outputCount: outs.length })];
  }
  return [];
}

/**
 * ENTROPY (Boltzmann). The quantitative version of ambiguity: how many valid
 * ways an observer could read who paid whom. Only reported when meaningful (3+
 * bits), where it complements the coinjoin/anonymity-set signals with a number.
 */
export function detectEntropy(tx: NormalizedTransaction): PrivacySignal[] {
  const inputs = tx.inputs.filter(i => !i.isCoinbase).map(i => i.valueSats).filter((v): v is number => v != null);
  if (inputs.length === 0) return [];
  const outputs = spendable(tx.outputs).map(o => o.valueSats);
  if (outputs.length === 0) return [];
  const { bits, method } = transactionEntropy(inputs, outputs);
  if (bits < 3) return [];
  const rounded = Math.round(bits * 10) / 10;
  return [sig('ENTROPY', tx.txid, 'info', method.startsWith('Boltzmann') ? 'strong' : 'possible',
    `Transaction entropy ~${rounded} bits`,
    `About ${rounded} bits of entropy (${method}): many valid ways to read which input funded which output. The higher this is, the more ambiguity and the better the privacy, the level of a CoinJoin.`,
    { highEntropy: true, entropyBits: rounded, inputCount: tx.inputs.length, outputCount: outputs.length })];
}

/** Does this transaction look like a CoinJoin (3+ equal outputs, 2+ inputs)? */
export function isCoinjoinLike(tx: NormalizedTransaction): boolean {
  return tx.inputs.length >= 2 && equalOutputPeak(spendable(tx.outputs)).count >= 3;
}

/**
 * POSTMIX. Spending coins that came out of a CoinJoin. Co-spending them with
 * unmixed coins re-links everything through common-input ownership; consolidating
 * several mixed coins merges their separate anonymity sets. `postmixInputs` is
 * supplied by the caller, which fetched the parent transactions.
 */
export function detectPostmix(tx: NormalizedTransaction, postmixInputs: number): PrivacySignal[] {
  if (tx.isCoinbase || postmixInputs <= 0) return [];
  const total = tx.inputs.length;
  if (postmixInputs < total) {
    return [sig('POSTMIX', tx.txid, 'high', 'strong', 'Postmix coins spent with unmixed coins',
      `${postmixInputs} of ${total} inputs came out of a CoinJoin. Spending mixed and unmixed coins together re-links them through common-input ownership, undoing much of the mix.`,
      { postmixMixed: true, postmixInputs, inputCount: total })];
  }
  if (total >= 2) {
    return [sig('POSTMIX', tx.txid, 'medium', 'strong', 'Postmix consolidation',
      `All ${total} inputs came out of a CoinJoin but are consolidated together, merging their separate anonymity sets back into one.`,
      { postmixConsolidation: true, postmixInputs, inputCount: total })];
  }
  return [];
}

/** Run every PURE transaction heuristic. POSTMIX needs parent context and is run
 *  separately by the analysis layer, which can fetch the parent transactions. */
export function detectTransactionHeuristics(tx: NormalizedTransaction): PrivacySignal[] {
  return [
    ...detectChangeDetection(tx),
    ...detectWalletFingerprint(tx),
    ...detectScriptTypeMix(tx),
    ...detectRoundAmount(tx),
    ...detectConsolidation(tx),
    ...detectCoinjoin(tx),
    ...detectCioh(tx),
    ...detectDustOutput(tx),
    ...detectDustSpending(tx),
    ...detectAnonymitySet(tx),
    ...detectEntropy(tx),
    ...detectPremix(tx),
  ];
}
