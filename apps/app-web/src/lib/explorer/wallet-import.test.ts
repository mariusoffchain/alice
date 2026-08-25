import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractWalletInput } from './wallet-import.ts';
import { HDKey } from '@scure/bip32';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

const b58 = base58check(sha256);
function zpub(): string {
  const xpub = HDKey.fromMasterSeed(new Uint8Array(64).fill(5)).derive("m/84'/0'/0'").publicExtendedKey;
  const raw = b58.decode(xpub);
  const p = Buffer.from('04b24746', 'hex');
  raw[0] = p[0]; raw[1] = p[1]; raw[2] = p[2]; raw[3] = p[3];
  return b58.encode(raw);
}
function xpub(): string {
  return HDKey.fromMasterSeed(new Uint8Array(64).fill(5)).derive("m/84'/0'/0'").publicExtendedKey;
}

describe('extractWalletInput', () => {
  it('returns a bare extended key unchanged', () => {
    const z = zpub();
    assert.equal(extractWalletInput(z), z);
    assert.equal(extractWalletInput(`  ${z}\n`), z);
  });

  it('returns a bare address unchanged', () => {
    assert.equal(extractWalletInput('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
    assert.equal(extractWalletInput('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'), '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  });

  it('extracts an address from a bitcoin: URI', () => {
    const uri = 'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.1&label=x';
    assert.equal(extractWalletInput(uri), '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  });

  it('extracts a descriptor from a generic JSON export', () => {
    const d = `wpkh(${xpub()}/0/*)`;
    assert.equal(extractWalletInput(JSON.stringify({ descriptor: d, label: 'Savings' })), d);
  });

  it('extracts an extended key nested in a ColdCard-style export', () => {
    const z = zpub();
    const json = JSON.stringify({ chain: 'BTC', bip84: { name: 'p2wpkh', xpub: z, deriv: "m/84'/0'/0'" } });
    assert.equal(extractWalletInput(json), z);
  });

  it('prefers a descriptor over a bare key when both are present', () => {
    const x = xpub();
    const d = `wpkh(${x}/<0;1>/*)`;
    const json = JSON.stringify({ xpub: x, descriptor: d });
    assert.equal(extractWalletInput(json), d);
  });

  it('finds a key inside free-form text', () => {
    const z = zpub();
    assert.equal(extractWalletInput(`My wallet key is:\n${z}\nkeep it safe`), z);
  });

  it('returns null when nothing recognisable is present', () => {
    assert.equal(extractWalletInput(''), null);
    assert.equal(extractWalletInput('hello world, no keys here'), null);
    assert.equal(extractWalletInput('{"note":"empty"}'), null);
  });
});
