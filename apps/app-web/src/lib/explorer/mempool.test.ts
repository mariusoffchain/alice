import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMempoolTx, type EsploraTx } from './mempool.ts';
import type { DataSource } from './types.ts';

const source: DataSource = { name: 'test', baseUrl: 'https://x/api' };

const confirmedTx: EsploraTx = {
  txid: 'a'.repeat(64),
  version: 2,
  locktime: 0,
  size: 222,
  weight: 561,
  fee: 1410,
  vin: [
    {
      txid: 'b'.repeat(64),
      vout: 0,
      prevout: { scriptpubkey_address: 'bc1qinput1', scriptpubkey_type: 'v0_p2wpkh', value: 100000 },
      sequence: 0xffffffff,
      is_coinbase: false,
    },
    {
      txid: 'c'.repeat(64),
      vout: 1,
      prevout: { scriptpubkey_address: 'bc1qinput2', scriptpubkey_type: 'v0_p2wpkh', value: 50000 },
      sequence: 0xfffffffd, // signals RBF
      is_coinbase: false,
    },
  ],
  vout: [
    { scriptpubkey_address: 'bc1qpay', scriptpubkey_type: 'v1_p2tr', value: 120000 },
    { scriptpubkey_address: 'bc1qchange', scriptpubkey_type: 'v0_p2wpkh', value: 28590 },
  ],
  status: { confirmed: true, block_height: 800000, block_time: 1690000000 },
};

describe('normalizeMempoolTx', () => {
  it('maps core fields and computes vsize', () => {
    const tx = normalizeMempoolTx(confirmedTx, source);
    assert.equal(tx.txid, 'a'.repeat(64));
    assert.equal(tx.vsize, Math.ceil(561 / 4)); // 141
    assert.equal(tx.inputs.length, 2);
    assert.equal(tx.outputs.length, 2);
    assert.equal(tx.source.name, 'test');
  });

  it('normalizes Esplora script names to the compact set', () => {
    const tx = normalizeMempoolTx(confirmedTx, source);
    assert.equal(tx.inputs[0].scriptType, 'p2wpkh');
    assert.equal(tx.outputs[0].scriptType, 'p2tr');
  });

  // Liquid: the fee is an explicit vout (scriptpubkey_type "fee") and the other
  // amounts are blinded (no `value`). The fee must not appear as a spendable
  // output, and confidential amounts must read as not-known, never a bogus 0.
  const liquidTx: EsploraTx = {
    txid: 'd'.repeat(64),
    version: 2,
    locktime: 0,
    size: 500,
    weight: 2000,
    vin: [
      { txid: 'e'.repeat(64), vout: 0, prevout: { scriptpubkey_type: 'v0_p2wpkh' }, sequence: 0xffffffff, is_coinbase: false },
    ],
    vout: [
      { scriptpubkey_address: 'lq1conf1', scriptpubkey_type: 'v0_p2wpkh' },
      { scriptpubkey_address: 'lq1conf2', scriptpubkey_type: 'v0_p2wpkh' },
      { scriptpubkey_type: 'fee', value: 448 },
    ],
    status: { confirmed: true, block_height: 3000000, block_time: 1690000000 },
  };

  it('extracts the Liquid fee output and flags confidential amounts', () => {
    const tx = normalizeMempoolTx(liquidTx, source);
    // The fee vout is pulled out of the spendable outputs and used as the fee.
    assert.equal(tx.outputs.length, 2);
    assert.equal(tx.feeSats, 448);
    // Confidential outputs read as not-known, with a placeholder 0 (never NaN).
    assert.equal(tx.outputs[0].amountKnown, false);
    assert.equal(tx.outputs[0].valueSats, 0);
    // The confidential input is not-known; its vout index is preserved.
    assert.equal(tx.inputs[0].amountKnown, false);
    assert.equal(tx.outputs[0].index, 0);
    assert.equal(tx.outputs[1].index, 1);
  });

  it('uses the provider fee and derives the fee rate over vsize', () => {
    const tx = normalizeMempoolTx(confirmedTx, source);
    assert.equal(tx.feeSats, 1410);
    assert.equal(tx.feeRateSatVb, 10); // 1410 / 141
  });

  it('detects RBF when any input sequence is below the ceiling', () => {
    const tx = normalizeMempoolTx(confirmedTx, source);
    assert.equal(tx.rbfSignaled, true);
  });

  it('derives the fee from sums when the provider omits it', () => {
    const noFee: EsploraTx = { ...confirmedTx, fee: undefined };
    const tx = normalizeMempoolTx(noFee, source);
    // (100000 + 50000) - (120000 + 28590) = 1410
    assert.equal(tx.feeSats, 1410);
  });

  it('treats a coinbase as feeless and never RBF', () => {
    const coinbase: EsploraTx = {
      ...confirmedTx,
      fee: undefined,
      vin: [{
        txid: '0'.repeat(64),
        vout: 0xffffffff,
        prevout: null,
        sequence: 0x00000000,
        is_coinbase: true,
      }],
    };
    const tx = normalizeMempoolTx(coinbase, source);
    assert.equal(tx.isCoinbase, true);
    assert.equal(tx.feeSats, null);
    assert.equal(tx.rbfSignaled, false);
  });

  it('reports an unconfirmed transaction without block data', () => {
    const pending: EsploraTx = { ...confirmedTx, status: { confirmed: false } };
    const tx = normalizeMempoolTx(pending, source);
    assert.equal(tx.status.confirmed, false);
    assert.equal(tx.status.blockHeight, undefined);
  });
});
