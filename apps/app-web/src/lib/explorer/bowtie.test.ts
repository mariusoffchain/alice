import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeBowtie } from './bowtie.ts';
import type { NormalizedTransaction } from './types.ts';

function tx(inputs: number[], outputs: number[], feeSats: number | null = 0): NormalizedTransaction {
  return {
    txid: 'a'.repeat(64), version: 2, locktime: 0, sizeBytes: 200, weight: 800, vsize: 200,
    feeSats, feeRateSatVb: 0, status: { confirmed: true, blockHeight: 1 },
    inputs: inputs.map((v, i) => ({ prevTxid: 'b'.repeat(64), prevVout: i, address: `in${i}`, valueSats: v, sequence: 0xffffffff, isCoinbase: false })),
    outputs: outputs.map((v, i) => ({ index: i, address: `out${i}`, valueSats: v })),
    isCoinbase: false, rbfSignaled: false, source: { name: 't', baseUrl: 'x' },
  };
}

describe('computeBowtie', () => {
  it('produces one ribbon per input and output when under the strand cap', () => {
    const layout = computeBowtie(tx([100, 50], [120, 30]));
    assert.equal(layout.inputs.length, 2);
    assert.equal(layout.outputs.length, 2);
    assert.equal(layout.inputOverflow, 0);
    assert.equal(layout.outputOverflow, 0);
    assert.equal(layout.truncatable, false);
  });

  it('sorts each side largest value first', () => {
    const layout = computeBowtie(tx([10, 900, 90], [500, 500]));
    assert.deepEqual(layout.inputs.map(i => i.valueSats), [900, 90, 10]);
  });

  it('gives a bigger-value ribbon a bigger stroke thickness', () => {
    const layout = computeBowtie(tx([1000], [990, 10]));
    const [big, small] = layout.outputs;
    assert.ok(big.thickness > small.thickness);
  });

  it('draws confidential (Liquid) outputs equal, not crushed by the fee output', () => {
    // A confidential tx: amounts blinded (valueSats 0, amountKnown false) with a
    // small visible fee. Previously the fee ate the output budget and the
    // unknown outputs collapsed to a hairline; they must now be equal ribbons,
    // at least as thick as the (also equal) unknown inputs.
    const confidential: NormalizedTransaction = {
      txid: 'a'.repeat(64), version: 2, locktime: 0, sizeBytes: 200, weight: 800, vsize: 200,
      feeSats: 40, feeRateSatVb: 0, status: { confirmed: true, blockHeight: 1 },
      inputs: [0, 1, 2].map(i => ({ prevTxid: 'b'.repeat(64), prevVout: i, valueSats: undefined, sequence: 0xffffffff, isCoinbase: false, amountKnown: false })),
      outputs: [0, 1].map(i => ({ index: i, valueSats: 0, amountKnown: false })),
      isCoinbase: false, rbfSignaled: false, source: { name: 't', baseUrl: 'x' },
    };
    const layout = computeBowtie(confidential);
    const outs = layout.outputs.filter(o => o.kind === 'output');
    assert.equal(outs.length, 2);
    assert.equal(outs[0].thickness, outs[1].thickness); // equal to each other
    assert.ok(outs[0].confidential);
    // Not crushed: with fewer outputs than inputs, each unknown output is at
    // least as thick as an unknown input (equal share per side).
    assert.ok(outs[0].thickness >= layout.inputs[0].thickness);
  });

  it('converges every ribbon exactly at the knot edge', () => {
    const layout = computeBowtie(tx([100, 200, 300], [250, 350], 0));
    // Inputs end at width/2 - midWidth*0.9 + 1 = 592, outputs mirrored at 608.
    for (const line of layout.inputs) {
      assert.match(line.path, / L 592 [\d.]+$/);
    }
    for (const line of layout.outputs) {
      assert.match(line.path, / L 608 [\d.]+$/);
    }
  });

  it('draws the ribbon as a stroked centerline (M L C L), not a closed band', () => {
    const layout = computeBowtie(tx([100], [100]));
    assert.match(layout.inputs[0].path, /^M .+ L .+ C .+ L .+$/);
    assert.ok(!layout.inputs[0].path.endsWith('Z'));
  });

  it('draws every strand but clips the ones past maxStrands off the bottom edge', () => {
    const outs = Array.from({ length: 61 }, (_, i) => 1000 - i); // 61 outputs
    const layout = computeBowtie(tx([100000], outs), { maxStrands: 24 });
    // Every output is a real individual line, no fold-away aggregate.
    assert.equal(layout.outputs.length, 61);
    assert.ok(layout.outputs.every(o => o.aggregateCount === 0));
    assert.equal(layout.outputOverflow, 61 - 24);
    assert.equal(layout.totalOutputs, 61);
    assert.ok(layout.truncatable);
    // The last strand starts below the drawing height, i.e. it is clipped.
    const outerY = (line: { path: string }) => Number(line.path.split(' ')[2]);
    assert.ok(outerY(layout.outputs[60]) > layout.height);
    assert.ok(outerY(layout.outputs[0]) < layout.height);
  });

  it('spreads every strand inside the grown height when expanded', () => {
    const outs = Array.from({ length: 61 }, (_, i) => 1000 - i);
    const compact = computeBowtie(tx([100000], outs));
    const layout = computeBowtie(tx([100000], outs), { expanded: true });
    assert.equal(layout.outputs.length, 61);
    assert.equal(layout.outputOverflow, 0);
    assert.ok(layout.height > compact.height);
    const outerY = (line: { path: string }) => Number(line.path.split(' ')[2]);
    assert.ok(outerY(layout.outputs[60]) <= layout.height);
  });

  it('consolidates lines past the hard lineLimit into one aggregate', () => {
    const outs = Array.from({ length: 300 }, (_, i) => 10000 - i);
    const layout = computeBowtie(tx([10000000], outs), { lineLimit: 250 });
    assert.equal(layout.outputs.length, 251); // 250 individual + 1 aggregate
    const agg = layout.outputs[layout.outputs.length - 1];
    assert.equal(agg.aggregateCount, 50);
    assert.equal(layout.totalOutputs, 300);
  });

  it('puts the fee first on the output side', () => {
    const layout = computeBowtie(tx([100000], [90000], 10000));
    assert.equal(layout.outputs[0].kind, 'fee');
    assert.equal(layout.outputs[0].valueSats, 10000);
  });

  it('omits the fee ribbon when there is no fee', () => {
    const layout = computeBowtie(tx([100000], [100000], 0));
    assert.equal(layout.outputs.some(o => o.kind === 'fee'), false);
  });

  it('renders a zero-value output as a stub with no marker or connector', () => {
    const layout = computeBowtie(tx([1000], [1000, 0]));
    const stub = layout.outputs.find(o => o.zeroValue);
    assert.ok(stub, 'a zero-value stub should be present');
    assert.equal(stub!.markerPath, undefined);
    assert.equal(stub!.connectorPath, undefined);
  });

  it('gives non-coinbase inputs and real outputs a connector path', () => {
    const layout = computeBowtie(tx([100, 50], [120, 30]));
    assert.ok(layout.inputs.every(i => typeof i.connectorPath === 'string'));
    assert.ok(layout.outputs.every(o => typeof o.connectorPath === 'string'));
  });

  it('sizes a coinbase input over the whole output total', () => {
    const coinbase: NormalizedTransaction = {
      ...tx([], [5000000000]),
      isCoinbase: true,
      feeSats: null,
      inputs: [{ prevTxid: '0'.repeat(64), prevVout: 0xffffffff, sequence: 0xffffffff, isCoinbase: true }],
    };
    const layout = computeBowtie(coinbase);
    assert.equal(layout.inputs.length, 1);
    assert.equal(layout.inputs[0].valueSats, undefined);
    // The single input carries the full knot weight, clamped to the max.
    assert.ok(layout.inputs[0].thickness > 90);
    assert.equal(layout.inputs[0].connectorPath, undefined);
  });

  it('exposes the middle bar covering the knot', () => {
    const layout = computeBowtie(tx([100], [100]));
    assert.equal(layout.middle.strokeWidth, 100.5);
    assert.ok(layout.hasLine);
  });
});
