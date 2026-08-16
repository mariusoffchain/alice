import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectAnonymitySet, detectChangeDetection, detectCioh, detectCoinjoin, detectConsolidation, detectDustOutput, detectDustSpending, detectEntropy, detectPeelChain, detectPostmix, detectPremix, detectRoundAmount, detectScriptTypeMix, detectWalletFingerprint, isCoinjoinLike, isPeelShape, isRoundAmount } from './heuristics.ts';
import { toAbstractSignal } from './audit-core.ts';
import type { NormalizedInput, NormalizedOutput, NormalizedTransaction } from './types.ts';

function input(over: Partial<NormalizedInput> = {}): NormalizedInput {
  return { prevTxid: 'a'.repeat(64), prevVout: 0, address: 'bc1qin', valueSats: 1_000_000, scriptType: 'p2wpkh', sequence: 0xffffffff, isCoinbase: false, ...over };
}
function output(over: Partial<NormalizedOutput> = {}): NormalizedOutput {
  return { index: 0, address: 'bc1qout', valueSats: 500_000, scriptType: 'p2wpkh', ...over };
}
function tx(over: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    txid: 'f'.repeat(64), version: 2, locktime: 0, sizeBytes: 200, weight: 800, vsize: 200,
    feeSats: 1000, feeRateSatVb: 5, status: { confirmed: true }, inputs: [input()], outputs: [output()],
    isCoinbase: false, rbfSignaled: false, source: { name: 'x', baseUrl: '' }, ...over,
  } as NormalizedTransaction;
}

describe('isRoundAmount', () => {
  it('flags round BTC and sat multiples, not arbitrary values', () => {
    assert.equal(isRoundAmount(10_000_000), true); // 0.1 BTC
    assert.equal(isRoundAmount(100_000), true);    // 0.001 BTC
    assert.equal(isRoundAmount(1_234_567), false);
  });
});

describe('detectChangeDetection', () => {
  it('deterministically flags an output returning to an input address', () => {
    const t = tx({
      inputs: [input({ address: 'bc1qalice' })],
      outputs: [output({ index: 0, address: 'bc1qbob', valueSats: 400_000 }), output({ index: 1, address: 'bc1qalice', valueSats: 590_000 })],
    });
    const [s] = detectChangeDetection(t);
    assert.equal(s.ruleId, 'CHANGE_DETECTION');
    assert.equal(s.confidence, 'certain');
    assert.equal(s.evidence.selfSend, true);
  });

  it('votes change on the classic two-output case (round + type mismatch)', () => {
    const t = tx({
      inputs: [input({ address: 'bc1qin', scriptType: 'p2wpkh' })],
      outputs: [
        output({ index: 0, address: '1LegacyPay', valueSats: 10_000_000, scriptType: 'p2pkh' }), // round payment, different type
        output({ index: 1, address: 'bc1qchange', valueSats: 1_234_567, scriptType: 'p2wpkh' }), // non-round, matches input type
      ],
    });
    const sigs = detectChangeDetection(t);
    assert.equal(sigs.length, 1);
    assert.equal(sigs[0].ruleId, 'CHANGE_DETECTION');
    assert.equal(sigs[0].evidence.roundAmount, true);
  });

  it('is silent on a coinbase', () => {
    assert.deepEqual(detectChangeDetection(tx({ isCoinbase: true })), []);
  });

  it('projects without any address or value', () => {
    const t = tx({ inputs: [input({ address: 'bc1qalice' })], outputs: [output({ address: 'bc1qalice', valueSats: 900000 })] });
    const [s] = detectChangeDetection(t);
    const a = toAbstractSignal(s);
    assert.ok(a);
    assert.equal(a.flags?.selfSend, true);
    assert.ok(!JSON.stringify(a).includes('bc1qalice'));
    assert.ok(!JSON.stringify(a).includes('900000'));
  });
});

describe('detectWalletFingerprint', () => {
  it('flags BIP69 lexicographic ordering', () => {
    const t = tx({
      inputs: [input({ prevTxid: '1'.repeat(64) }), input({ prevTxid: '2'.repeat(64) })],
      outputs: [output({ index: 0, valueSats: 100_000 }), output({ index: 1, valueSats: 900_000 })],
    });
    const [s] = detectWalletFingerprint(t);
    assert.equal(s.ruleId, 'WALLET_FINGERPRINT');
    assert.equal(s.evidence.bip69, true);
  });

  it('does not flag out-of-order inputs', () => {
    const t = tx({
      inputs: [input({ prevTxid: '2'.repeat(64) }), input({ prevTxid: '1'.repeat(64) })],
      outputs: [output({ index: 0, valueSats: 100_000 }), output({ index: 1, valueSats: 900_000 })],
    });
    assert.deepEqual(detectWalletFingerprint(t), []);
  });
});

describe('detectScriptTypeMix', () => {
  it('flags mixed types and rewards uniform types', () => {
    const mixed = tx({
      inputs: [input({ scriptType: 'p2wpkh' })],
      outputs: [output({ index: 0, scriptType: 'p2pkh', valueSats: 400000 }), output({ index: 1, scriptType: 'p2tr', valueSats: 500000 })],
    });
    assert.equal(detectScriptTypeMix(mixed)[0].evidence.mixed, true);

    const uniform = tx({
      inputs: [input({ scriptType: 'p2wpkh' })],
      outputs: [output({ index: 0, scriptType: 'p2wpkh', valueSats: 400000 }), output({ index: 1, scriptType: 'p2wpkh', valueSats: 500000 })],
    });
    const u = detectScriptTypeMix(uniform)[0];
    assert.equal(u.severity, 'info');
    assert.equal(u.evidence.uniform, true);
  });
});

describe('detectRoundAmount', () => {
  it('flags a round output among non-round ones', () => {
    const t = tx({ outputs: [output({ index: 0, valueSats: 10_000_000 }), output({ index: 1, valueSats: 1_234_567 })] });
    const [s] = detectRoundAmount(t);
    assert.equal(s.ruleId, 'ROUND_AMOUNT');
    assert.equal(s.evidence.someRound, true);
  });
});

describe('detectConsolidation', () => {
  it('flags many inputs into one output', () => {
    const t = tx({ inputs: [input(), input(), input(), input()], outputs: [output({ valueSats: 3_500_000 })] });
    const s = detectConsolidation(t);
    assert.ok(s.some(x => x.evidence.fanIn === true));
  });
});

describe('detectCoinjoin', () => {
  it('flags equal-value outputs as a positive coinjoin signal', () => {
    const eq = (i: number) => output({ index: i, address: `bc1q${i}`, valueSats: 1_000_000 });
    const t = tx({ inputs: [input(), input(), input()], outputs: [eq(0), eq(1), eq(2), output({ index: 3, valueSats: 123456 })] });
    const [s] = detectCoinjoin(t);
    assert.equal(s.ruleId, 'COINJOIN');
    assert.equal(s.severity, 'info');
    assert.equal(s.evidence.equalOutputs, 3);
  });
});

describe('detectCioh', () => {
  it('clusters multiple input addresses, stays quiet on a single one, skips coinjoins', () => {
    const multi = tx({ inputs: [input({ address: 'bc1qa' }), input({ address: 'bc1qb' }), input({ address: 'bc1qc' })], outputs: [output({ valueSats: 2_900_000 })] });
    const [c] = detectCioh(multi);
    assert.equal(c.ruleId, 'CIOH');
    assert.equal(c.evidence.clustered, true);
    assert.equal(c.evidence.inputAddressCount, 3);

    const single = tx({ inputs: [input({ address: 'bc1qa' })], outputs: [output({ index: 0, valueSats: 400000 }), output({ index: 1, valueSats: 590000 })] });
    assert.equal(detectCioh(single)[0].evidence.singleInput, true);

    // 3 equal outputs + 2 inputs = coinjoin, CIOH suppressed
    const eq = (i: number) => output({ index: i, address: `bc1q${i}`, valueSats: 1_000_000 });
    const cj = tx({ inputs: [input({ address: 'bc1qa' }), input({ address: 'bc1qb' })], outputs: [eq(0), eq(1), eq(2)] });
    assert.deepEqual(detectCioh(cj), []);
  });
});

describe('dusting', () => {
  it('flags a dust attack output and dust co-spending', () => {
    const attack = tx({ inputs: [input()], outputs: [output({ index: 0, valueSats: 400 }), output({ index: 1, valueSats: 990_000 })] });
    assert.equal(detectDustOutput(attack)[0].evidence.dustAttack, true);

    const spend = tx({ inputs: [input({ valueSats: 200 }), input({ valueSats: 1_000_000 })], outputs: [output({ valueSats: 990_000 })] });
    const [s] = detectDustSpending(spend);
    assert.equal(s.ruleId, 'DUST_SPENDING');
    assert.equal(s.severity, 'high');
  });
});

describe('detectPeelChain', () => {
  it('needs the peel shape and a confirmed hop', () => {
    const peel = tx({ inputs: [input()], outputs: [output({ index: 0, valueSats: 9_900_000 }), output({ index: 1, valueSats: 50_000 })] });
    assert.equal(isPeelShape(peel), true);
    // A lone peel-shaped tx (no confirmed neighbours) is not flagged.
    assert.deepEqual(detectPeelChain(peel, { parentPeelLinked: false, childPeelLinked: false }), []);
    // With a confirmed parent hop it becomes a chain.
    const [s] = detectPeelChain(peel, { parentPeelLinked: true, childPeelLinked: false });
    assert.equal(s.ruleId, 'PEEL_CHAIN');
    assert.equal(s.evidence.chainDepth, 2);
    // Both hops = deeper chain, higher severity.
    assert.equal(detectPeelChain(peel, { parentPeelLinked: true, childPeelLinked: true })[0].severity, 'high');
  });
});

describe('detectPremix', () => {
  it('flags a Whirlpool TX0 structure with toxic change', () => {
    const denom = (i: number) => output({ index: i, address: `bc1q${i}`, valueSats: 1_000_000 });
    const t = tx({
      inputs: [input({ valueSats: 3_100_000 })],
      outputs: [denom(0), denom(1), output({ index: 2, address: 'bc1qfee', valueSats: 5_000 }), output({ index: 3, address: 'bc1qchange', valueSats: 90_000 })],
    });
    const [s] = detectPremix(t);
    assert.equal(s.ruleId, 'PREMIX');
    assert.equal(s.evidence.premix, true);
    assert.equal(s.evidence.toxicChange, true);
  });
});

describe('detectAnonymitySet', () => {
  it('reports a strong anonymity set for 5 equal outputs', () => {
    const eq = (i: number) => output({ index: i, address: `bc1q${i}`, valueSats: 1_000_000 });
    const t = tx({ inputs: [input(), input()], outputs: [eq(0), eq(1), eq(2), eq(3), eq(4)] });
    const [s] = detectAnonymitySet(t);
    assert.equal(s.evidence.strongAnonset, true);
    assert.equal(s.evidence.anonsetSize, 5);
  });
});

describe('detectEntropy & isCoinjoinLike', () => {
  it('reports high entropy for an equal-output coinjoin', () => {
    const inN = (i: number) => input({ prevTxid: String(i).repeat(64).slice(0, 64), valueSats: 1_000_000 });
    const eq = (i: number) => output({ index: i, address: `bc1q${i}`, valueSats: 1_000_000 });
    const t = tx({ inputs: [inN(1), inN(2), inN(3), inN(4), inN(5)], outputs: [eq(0), eq(1), eq(2), eq(3), eq(4)] });
    const [s] = detectEntropy(t);
    assert.equal(s.ruleId, 'ENTROPY');
    assert.equal(s.evidence.highEntropy, true);
    assert.equal(isCoinjoinLike(t), true);
  });

  it('is silent on a plain 1-in-1-out', () => {
    const t = tx({ inputs: [input()], outputs: [output({ valueSats: 990_000 })] });
    assert.deepEqual(detectEntropy(t), []);
  });
});

describe('detectPostmix', () => {
  it('flags mixed postmix + unmixed inputs as high severity', () => {
    const t = tx({ inputs: [input(), input(), input()] });
    const [s] = detectPostmix(t, 1);
    assert.equal(s.ruleId, 'POSTMIX');
    assert.equal(s.severity, 'high');
    assert.equal(s.evidence.postmixMixed, true);
  });

  it('flags consolidating only postmix coins as medium, and stays silent with none', () => {
    const t = tx({ inputs: [input(), input()] });
    assert.equal(detectPostmix(t, 2)[0].evidence.postmixConsolidation, true);
    assert.deepEqual(detectPostmix(t, 0), []);
  });
});
