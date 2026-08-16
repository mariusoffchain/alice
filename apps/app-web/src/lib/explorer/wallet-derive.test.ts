import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  parseWalletInput,
  deriveAddress,
  deriveChain,
  deriveNetworkFor,
  WalletInputError,
} from './wallet-derive.ts';

const b58 = base58check(sha256);

// A deterministic account key, re-encoded under different SLIP-132 prefixes so
// the same underlying key can be presented as xpub / ypub / zpub.
function accountKey(path: string): HDKey {
  return HDKey.fromMasterSeed(new Uint8Array(64).fill(7)).derive(path);
}
function reVersion(xpub: string, hexPrefix: string): string {
  const raw = b58.decode(xpub);
  const p = Buffer.from(hexPrefix, 'hex');
  raw[0] = p[0]; raw[1] = p[1]; raw[2] = p[2]; raw[3] = p[3];
  return b58.encode(raw);
}

describe('wallet-derive', () => {
  it('maps networkIds to derivation networks', () => {
    assert.equal(deriveNetworkFor('mainnet'), 'bitcoin');
    assert.equal(deriveNetworkFor('testnet4'), 'testnet');
    assert.equal(deriveNetworkFor('signet'), 'testnet');
    assert.equal(deriveNetworkFor('mutinynet'), 'testnet');
  });

  it('wraps a zpub into a native-segwit descriptor with both chains', () => {
    const xpub = accountKey("m/84'/0'/0'").publicExtendedKey;
    const zpub = reVersion(xpub, '04b24746');
    const w = parseWalletInput(zpub, 'bitcoin');
    assert.equal(w.kind, 'xpub');
    assert.equal(w.scriptHint, 'p2wpkh');
    assert.equal(w.network, 'bitcoin');
    assert.match(w.receive, /^wpkh\(xpub.*\/0\/\*\)$/);
    assert.match(w.change ?? '', /^wpkh\(xpub.*\/1\/\*\)$/);
    // Receive index 0 is a bech32 address.
    assert.match(deriveAddress(w.receive, 0, 'bitcoin'), /^bc1q/);
  });

  it('wraps an xpub as legacy p2pkh and a ypub as p2sh-wrapped segwit', () => {
    const xpub = accountKey("m/44'/0'/0'").publicExtendedKey;
    const legacy = parseWalletInput(xpub, 'bitcoin');
    assert.equal(legacy.scriptHint, 'p2pkh');
    assert.match(deriveAddress(legacy.receive, 0, 'bitcoin'), /^1/);

    const ypub = reVersion(accountKey("m/49'/0'/0'").publicExtendedKey, '049d7cb2');
    const nested = parseWalletInput(ypub, 'bitcoin');
    assert.equal(nested.scriptHint, 'p2sh');
    assert.match(deriveAddress(nested.receive, 0, 'bitcoin'), /^3/);
  });

  it('derives distinct, stable addresses per index', () => {
    const xpub = accountKey("m/84'/0'/0'").publicExtendedKey;
    const zpub = reVersion(xpub, '04b24746');
    const w = parseWalletInput(zpub, 'bitcoin');
    const chain = deriveChain(w.receive, 0, 3, 'bitcoin');
    assert.equal(chain.length, 3);
    assert.equal(new Set(chain.map(c => c.address)).size, 3);
    // Stable across calls.
    assert.equal(deriveAddress(w.receive, 1, 'bitcoin'), chain[1].address);
  });

  it('accepts a raw ranged descriptor and reads its script type', () => {
    const xpub = accountKey("m/86'/0'/0'").publicExtendedKey;
    const w = parseWalletInput(`tr(${xpub}/0/*)`, 'bitcoin');
    assert.equal(w.kind, 'descriptor');
    assert.equal(w.scriptHint, 'p2tr');
    assert.equal(w.change, undefined);
    assert.match(deriveAddress(w.receive, 0, 'bitcoin'), /^bc1p/);
  });

  it('splits a multipath descriptor into receive and change', () => {
    const xpub = accountKey("m/84'/0'/0'").publicExtendedKey;
    const w = parseWalletInput(`wpkh(${xpub}/<0;1>/*)`, 'bitcoin');
    assert.match(w.receive, /\/0\/\*\)$/);
    assert.match(w.change ?? '', /\/1\/\*\)$/);
    // The two chains produce different index-0 addresses.
    assert.notEqual(deriveAddress(w.receive, 0, 'bitcoin'), deriveAddress(w.change!, 0, 'bitcoin'));
  });

  it('derives the same addresses from a zpub and its key-origin descriptor', () => {
    // A wallet exported two ways: a standalone zpub, and a Sparrow/Passport-style
    // descriptor carrying the key origin and a multipath. Same key, so the same
    // addresses; this is the "descriptor vs xpub" case that must stay consistent.
    const xpub = accountKey("m/84'/0'/0'").publicExtendedKey;
    const zpub = reVersion(xpub, '04b24746');
    const fromZpub = parseWalletInput(zpub, 'bitcoin');
    const fromDesc = parseWalletInput(`wpkh([abcdef12/84h/0h/0h]${xpub}/<0;1>/*)#checksum`, 'bitcoin');
    for (let i = 0; i < 3; i += 1) {
      assert.equal(deriveAddress(fromDesc.receive, i, 'bitcoin'), deriveAddress(fromZpub.receive, i, 'bitcoin'));
      assert.equal(deriveAddress(fromDesc.change!, i, 'bitcoin'), deriveAddress(fromZpub.change!, i, 'bitcoin'));
    }
  });

  it('accepts {0,1} multipath notation and internal whitespace', () => {
    const xpub = accountKey("m/84'/0'/0'").publicExtendedKey;
    const a = parseWalletInput(`wpkh([abcdef12/84h/0h/0h]${xpub}/{0,1}/*)`, 'bitcoin');
    const b = parseWalletInput(`wpkh(${xpub}/<0;1>/*)\n`, 'bitcoin');
    assert.equal(deriveAddress(a.receive, 0, 'bitcoin'), deriveAddress(b.receive, 0, 'bitcoin'));
    assert.ok(a.change && b.change);
  });

  it('recognises testnet extended keys (tpub)', () => {
    const xpub = accountKey("m/84'/1'/0'").publicExtendedKey;
    const tpub = reVersion(xpub, '043587cf');
    const w = parseWalletInput(tpub, 'testnet');
    assert.equal(w.network, 'testnet');
    assert.match(deriveAddress(w.receive, 0, 'testnet'), /^(tb1|bcrt1|[mn2])/);
  });

  it('derives a multisig descriptor', () => {
    const a = accountKey("m/48'/0'/0'/2'").publicExtendedKey;
    const b = accountKey("m/48'/0'/1'/2'").publicExtendedKey;
    const w = parseWalletInput(`wsh(sortedmulti(2,${a}/0/*,${b}/0/*))`, 'bitcoin');
    assert.equal(w.scriptHint, 'multisig');
    assert.match(deriveAddress(w.receive, 0, 'bitcoin'), /^bc1q/);
  });

  it('rejects empty, malformed keys and unranged descriptors', () => {
    assert.throws(() => parseWalletInput('', 'bitcoin'), WalletInputError);
    assert.throws(() => parseWalletInput('not-a-key', 'bitcoin'), WalletInputError);
    assert.throws(() => parseWalletInput('xpubGARBAGE', 'bitcoin'), WalletInputError);
    const xpub = accountKey("m/84'/0'/0'").publicExtendedKey;
    // No `*` range.
    assert.throws(() => parseWalletInput(`wpkh(${xpub}/0/0)`, 'bitcoin'), WalletInputError);
  });
});
