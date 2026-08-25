import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { looksLikeArkadeAddress, looksLikeTxid, normalizeVtxo } from './arkade.ts';

describe('normalizeVtxo', () => {
  it('reads the SDK VirtualCoin shape (flat outpoint, value, virtualStatus)', () => {
    const v = normalizeVtxo({
      txid: 'a'.repeat(64),
      vout: 1,
      value: 15046,
      status: { confirmed: false },
      createdAt: new Date(1_786_771_107_000),
      virtualStatus: {
        state: 'preconfirmed',
        commitmentTxIds: ['c'.repeat(64)],
        batchExpiry: 1_789_269_053_000,
      },
    });
    assert.equal(v.txid, 'a'.repeat(64));
    assert.equal(v.vout, 1);
    assert.equal(v.amountSats, 15046);
    assert.equal(v.isPreconfirmed, true);
    assert.equal(v.isSpent, false);
    assert.equal(v.createdAt, 1_786_771_107);
    assert.equal(v.expiresAt, 1_789_269_053);
    assert.deepEqual(v.commitmentTxids, ['c'.repeat(64)]);
  });

  it('reads the raw gateway shape (nested outpoint, string amounts)', () => {
    const v = normalizeVtxo({
      outpoint: { txid: 'b'.repeat(64), vout: 0 },
      amount: '38000',
      isPreconfirmed: false,
      isSpent: true,
      createdAt: '1786765019',
      expiresAt: '1789357275',
      commitmentTxids: ['d'.repeat(64)],
    });
    assert.equal(v.txid, 'b'.repeat(64));
    assert.equal(v.amountSats, 38000);
    assert.equal(v.isSpent, true);
    assert.equal(v.isPreconfirmed, false);
    assert.equal(v.createdAt, 1_786_765_019);
    assert.equal(v.expiresAt, 1_789_357_275);
    assert.deepEqual(v.commitmentTxids, ['d'.repeat(64)]);
  });

  it('maps the swept and spent virtualStatus states', () => {
    assert.equal(normalizeVtxo({ txid: 'a'.repeat(64), vout: 0, value: 1, virtualStatus: { state: 'swept' } }).isSwept, true);
    assert.equal(normalizeVtxo({ txid: 'a'.repeat(64), vout: 0, value: 1, virtualStatus: { state: 'spent' } }).isSpent, true);
    const settled = normalizeVtxo({ txid: 'a'.repeat(64), vout: 0, value: 1, virtualStatus: { state: 'settled' } });
    assert.equal(settled.isSpent || settled.isSwept || settled.isPreconfirmed, false);
  });
});

describe('input prefilters', () => {
  it('recognises Arkade addresses and txids', () => {
    assert.equal(looksLikeArkadeAddress('ark1qzpq904am6clw3pgqwyh4p02708fy4xs0hcpwt7rwfdttuxsjameezgu4rz4mh977mt5zc2gquwfdy94npcvgfg865k8dt077z5a70aykxu669'), true);
    assert.equal(looksLikeArkadeAddress('bc1qzzdzp5c443vsetzatf2ra6hku322y7e5aq50rs'), false);
    assert.equal(looksLikeTxid('f'.repeat(64)), true);
    assert.equal(looksLikeTxid('f'.repeat(63)), false);
  });
});
