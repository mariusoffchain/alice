import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtendedVirtualCoin } from '@arkade-os/sdk';
import {
  FROZEN_FUNDS_ERROR,
  selectBitcoinVtxos,
  sendBitcoinRespectingFreeze,
  vtxoId,
} from './frozen-vtxos.ts';

const VTXO_MINIMUM = 330;

function arkadeInfo() {
  return { arkProvider: { getInfo: async () => ({ vtxoMinAmount: BigInt(VTXO_MINIMUM) }) } };
}

function vtxo(txByte: string, value: number): ExtendedVirtualCoin {
  return {
    txid: txByte.repeat(64),
    vout: 0,
    value,
    createdAt: new Date(),
    status: { confirmed: true },
    script: '00',
    isUnrolled: false,
    virtualStatus: { state: 'settled' },
    assets: [],
  } as unknown as ExtendedVirtualCoin;
}

test('coin selection requires the live Arkade VTXO minimum for change', () => {
  const inputs = [vtxo('1', 500), vtxo('2', 700), vtxo('3', 2_000)];
  assert.deepEqual(selectBitcoinVtxos(inputs, 500, VTXO_MINIMUM).map(input => input.value), [500]);
  assert.deepEqual(selectBitcoinVtxos(inputs, 600, VTXO_MINIMUM).map(input => input.value), [2_000]);
  assert.deepEqual(selectBitcoinVtxos(inputs, 1_000, VTXO_MINIMUM).map(input => input.value), [2_000]);
});

test('a 3,801-sat Arkade VTXO rejects a 3,700-sat payment that leaves dust change', async () => {
  const input = vtxo('4', 3_801);
  const wallet = {
    ...arkadeInfo(),
    getVtxos: async () => [input],
    sendBitcoin: async () => 'unexpected',
  };
  await assert.rejects(
    () => sendBitcoinRespectingFreeze(
      wallet as never,
      { getFrozenVtxos: async () => [] },
      'ark1recipient',
      3_700,
    ),
    /ARKADE_VTXO_DUST_LIMIT:330/,
  );
});

test('an Arkade payment below the live VTXO minimum is rejected', async () => {
  const input = vtxo('5', 3_801);
  const wallet = {
    ...arkadeInfo(),
    getVtxos: async () => [input],
    sendBitcoin: async () => 'unexpected',
  };
  await assert.rejects(
    () => sendBitcoinRespectingFreeze(
      wallet as never,
      { getFrozenVtxos: async () => [] },
      'ark1recipient',
      1,
    ),
    /ARKADE_VTXO_DUST_LIMIT:330/,
  );
});

test('a 3,801-sat Arkade VTXO permits a 3,471-sat payment with 330-sat change', () => {
  const inputs = [vtxo('4', 3_801)];
  assert.deepEqual(selectBitcoinVtxos(inputs, 3_471, VTXO_MINIMUM).map(input => input.value), [3_801]);
});

test('payments use only unfrozen VTXOs', async () => {
  const frozen = vtxo('1', 2_000);
  const available = vtxo('2', 3_000);
  let selected: ExtendedVirtualCoin[] = [];
  const wallet = {
    ...arkadeInfo(),
    getVtxos: async () => [frozen, available],
    sendBitcoin: async (params: { selectedVtxos?: ExtendedVirtualCoin[] }) => {
      selected = params.selectedVtxos ?? [];
      return 'txid';
    },
  };
  const result = await sendBitcoinRespectingFreeze(
    wallet as never,
    { getFrozenVtxos: async () => [{ id: vtxoId(frozen), frozenAt: 1 }] },
    'ark1recipient',
    1_000,
  );
  assert.equal(result, 'txid');
  assert.deepEqual(selected.map(vtxoId), [vtxoId(available)]);
});

test('payments explain when only frozen funds can cover the amount', async () => {
  const frozen = vtxo('1', 2_000);
  const wallet = {
    ...arkadeInfo(),
    getVtxos: async () => [frozen],
    sendBitcoin: async () => 'unexpected',
  };
  await assert.rejects(
    () => sendBitcoinRespectingFreeze(
      wallet as never,
      { getFrozenVtxos: async () => [{ id: vtxoId(frozen), frozenAt: 1 }] },
      'ark1recipient',
      1_000,
    ),
    new RegExp(FROZEN_FUNDS_ERROR),
  );
});
