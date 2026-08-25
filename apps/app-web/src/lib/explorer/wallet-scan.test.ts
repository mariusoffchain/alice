import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanWallet } from './wallet-scan.ts';
import type { WalletDescriptor } from './wallet-derive.ts';
import { deriveAddress } from './wallet-derive.ts';
import type { ChainDataProvider } from './provider.ts';
import { ChainDataError } from './provider.ts';
import type { AddressStats } from './signals.ts';
import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

const b58 = base58check(sha256);

function zpubDescriptor(): WalletDescriptor {
  const xpub = HDKey.fromMasterSeed(new Uint8Array(64).fill(9)).derive("m/84'/0'/0'").publicExtendedKey;
  const raw = b58.decode(xpub);
  const p = Buffer.from('04b24746', 'hex');
  raw[0] = p[0]; raw[1] = p[1]; raw[2] = p[2]; raw[3] = p[3];
  const zpub = b58.encode(raw);
  // Rebuild via plain xpub wrap to match wallet-derive output.
  return {
    receive: `wpkh(${xpub}/0/*)`,
    change: `wpkh(${xpub}/1/*)`,
    scriptHint: 'p2wpkh',
    network: 'bitcoin',
    kind: 'xpub',
  };
}

// A provider that reports activity for a fixed set of addresses.
function providerWith(active: Map<string, AddressStats>): ChainDataProvider {
  return {
    source: { name: 'fake', baseUrl: 'x' },
    async getTransaction() { throw new Error('unused'); },
    async getAddressStats(address): Promise<AddressStats> {
      return active.get(address) ?? {
        address, fundedCount: 0, spentCount: 0, txCount: 0, fundedSum: 0, spentSum: 0,
      };
    },
  };
}

function stats(address: string, funded: number, spent: number, tx: number): AddressStats {
  return { address, fundedCount: 1, spentCount: spent > 0 ? 1 : 0, txCount: tx, fundedSum: funded, spentSum: spent };
}

describe('wallet-scan', () => {
  it('finds used addresses, aggregates balance and stops after the gap limit', async () => {
    const w = zpubDescriptor();
    const r0 = deriveAddress(w.receive, 0, 'bitcoin');
    const r2 = deriveAddress(w.receive, 2, 'bitcoin');
    const c0 = deriveAddress(w.change!, 0, 'bitcoin');
    const active = new Map<string, AddressStats>([
      [r0, stats(r0, 100_000, 0, 1)],
      [r2, stats(r2, 50_000, 20_000, 2)],
      [c0, stats(c0, 10_000, 0, 1)],
    ]);

    const scan = await scanWallet(w, providerWith(active), { gapLimit: 20 });
    assert.equal(scan.usedCount, 3);
    // Balance = 100k + (50k-20k) + 10k.
    assert.equal(scan.balanceSats, 140_000);
    assert.equal(scan.txTotal, 4);
    assert.equal(scan.degraded, false);
    assert.deepEqual(scan.receive.map(a => a.index).sort((a, b) => a - b), [0, 2]);
    assert.deepEqual(scan.change.map(a => a.index), [0]);
  });

  it('marks the scan degraded when a lookup fails', async () => {
    const w = zpubDescriptor();
    const r0 = deriveAddress(w.receive, 0, 'bitcoin');
    const provider: ChainDataProvider = {
      source: { name: 'fake', baseUrl: 'x' },
      async getTransaction() { throw new Error('unused'); },
      async getAddressStats(address): Promise<AddressStats> {
        if (address === r0) throw new Error('429');
        return { address, fundedCount: 0, spentCount: 0, txCount: 0, fundedSum: 0, spentSum: 0 };
      },
    };
    const scan = await scanWallet(w, provider, { gapLimit: 20 });
    assert.equal(scan.degraded, true);
  });

  it('collects UTXOs for funded addresses when asked', async () => {
    const w = zpubDescriptor();
    const r0 = deriveAddress(w.receive, 0, 'bitcoin');
    const active = new Map<string, AddressStats>([[r0, stats(r0, 100_000, 0, 1)]]);
    const provider: ChainDataProvider = {
      ...providerWith(active),
      async getAddressUtxos(address) {
        return address === r0 ? [{ valueSats: 100_000, blockTime: 1_700_000_000 }] : [];
      },
    };
    const scan = await scanWallet(w, provider, { gapLimit: 20, includeUtxos: true });
    assert.equal(scan.utxos?.length, 1);
    assert.equal(scan.utxos?.[0].address, r0);
    assert.equal(scan.utxos?.[0].valueSats, 100_000);
  });

  it('reports an all-empty wallet as unused with zero balance', async () => {
    const w = zpubDescriptor();
    const scan = await scanWallet(w, providerWith(new Map()), { gapLimit: 20, maxAddresses: 40 });
    assert.equal(scan.usedCount, 0);
    assert.equal(scan.balanceSats, 0);
    assert.equal(scan.receive.length, 0);
    assert.equal(scan.throttled, false);
  });

  it('streams cumulative progress across both chains', async () => {
    const w = zpubDescriptor();
    const updates: { scanned: number; used: number }[] = [];
    await scanWallet(w, providerWith(new Map()), {
      gapLimit: 20, maxAddresses: 40, onProgress: p => updates.push(p),
    });
    assert.ok(updates.length >= 2, 'expected at least one progress tick per chain');
    // Cumulative and monotonically non-decreasing.
    assert.equal(updates[updates.length - 1].scanned, 40); // 20 receive + 20 change
    for (let i = 1; i < updates.length; i += 1) {
      assert.ok(updates[i].scanned >= updates[i - 1].scanned);
    }
  });

  it('bails out (throttled) once the wall-clock deadline is exceeded', async () => {
    const w = zpubDescriptor();
    let calls = 0;
    const provider: ChainDataProvider = {
      source: { name: 'slow', baseUrl: 'x' },
      async getTransaction() { throw new Error('unused'); },
      async getAddressStats(address): Promise<AddressStats> {
        calls += 1;
        await new Promise(r => setTimeout(r, 10)); // each lookup takes a beat
        return { address, fundedCount: 0, spentCount: 0, txCount: 0, fundedSum: 0, spentSum: 0 };
      },
    };
    // A tiny budget: after the first window the deadline is already blown.
    const scan = await scanWallet(w, provider, { gapLimit: 20, maxAddresses: 200, deadlineMs: 5 });
    assert.equal(scan.throttled, true);
    // It did not grind through the whole 200-per-chain cap.
    assert.ok(calls <= 40, `expected an early bail, got ${calls} lookups`);
  });

  it('stops early and flags throttled when every lookup fails', async () => {
    const w = zpubDescriptor();
    let calls = 0;
    const provider: ChainDataProvider = {
      source: { name: 'fake', baseUrl: 'x' },
      async getTransaction() { throw new Error('unused'); },
      async getAddressStats(): Promise<AddressStats> { calls += 1; throw new Error('429'); },
    };
    const scan = await scanWallet(w, provider, { gapLimit: 20, maxAddresses: 200 });
    assert.equal(scan.throttled, true);
    assert.equal(scan.degraded, true);
    // It gave up after a few failed windows on the receive chain and skipped
    // change entirely, nowhere near the 200-per-chain cap.
    assert.ok(calls <= 20 * 3, `expected an early bail, got ${calls} lookups`);
  });
  it('stops dead and rejects aborted when the signal fires mid-scan', async () => {
    const w = zpubDescriptor();
    let calls = 0;
    const controller = new AbortController();
    const provider: ChainDataProvider = {
      source: { name: 'fake', baseUrl: 'x' },
      async getTransaction() { throw new Error('unused'); },
      async getAddressStats(address, opts): Promise<AddressStats> {
        calls += 1;
        // Abort while the very first window is in flight.
        if (calls === 3) controller.abort();
        if (opts?.signal?.aborted) throw new ChainDataError('aborted', 'cancelled');
        return { address, fundedCount: 1, spentCount: 0, txCount: 1, fundedSum: 0, spentSum: 0 };
      },
    };
    await assert.rejects(
      () => scanWallet(w, provider, { gapLimit: 20, maxAddresses: 200, signal: controller.signal }),
      (err: unknown) => err instanceof ChainDataError && err.code === 'aborted',
    );
    // Only the first window was ever requested; nothing beyond it.
    assert.ok(calls <= 20, `expected the scan to stop at one window, got ${calls}`);
  });
});
