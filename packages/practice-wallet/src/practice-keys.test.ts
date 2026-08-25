import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Address, OutScript, TEST_NETWORK } from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { PRACTICE_DERIVATION_ACCOUNT, PracticeKeyring } from './practice-keys.ts';

// Standard BIP39 test mnemonic; its BIP84 testnet descendants are published
// reference vectors (used by BDK and others).
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('derives the known BIP84 testnet reference address at 0/0', () => {
  const keyring = new PracticeKeyring(TEST_MNEMONIC);
  const info = keyring.addressAt(false, 0);
  assert.equal(info.address, 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl');
  assert.equal(info.path, "m/84'/1'/0'/0/0");
  assert.equal(info.change, false);
  assert.equal(info.index, 0);
});

test('normalizes the mnemonic before deriving', () => {
  const keyring = new PracticeKeyring(`  ${TEST_MNEMONIC.toUpperCase()}  `);
  assert.equal(
    keyring.addressAt(false, 0).address,
    'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
  );
});

test('derivation is deterministic and distinct per chain and index', () => {
  const keyring = new PracticeKeyring(TEST_MNEMONIC);
  const first = keyring.addressAt(false, 0).address;
  assert.equal(keyring.addressAt(false, 0).address, first);
  const addresses = new Set([
    first,
    keyring.addressAt(false, 1).address,
    keyring.addressAt(true, 0).address,
    keyring.addressAt(true, 1).address,
  ]);
  assert.equal(addresses.size, 4);
  for (const address of addresses) {
    assert.match(address, /^tb1q[0-9a-z]{38}$/);
  }
});

test('scriptAt matches the script encoded in the address', () => {
  const keyring = new PracticeKeyring(TEST_MNEMONIC);
  const info = keyring.addressAt(true, 3);
  const decoded = Address(TEST_NETWORK).decode(info.address);
  assert.deepEqual(keyring.scriptAt(true, 3), OutScript.encode(decoded));
});

test('privateKeyAt returns 32-byte keys', () => {
  const keyring = new PracticeKeyring(TEST_MNEMONIC);
  assert.equal(keyring.privateKeyAt(false, 0).length, 32);
});

test('rejects an empty mnemonic and invalid indexes', () => {
  assert.throws(() => new PracticeKeyring('   '), /without a mnemonic/);
  const keyring = new PracticeKeyring(TEST_MNEMONIC);
  assert.throws(() => keyring.addressAt(false, -1), /Invalid practice derivation index/);
  assert.throws(() => keyring.addressAt(false, 1.5), /Invalid practice derivation index/);
});

test('a watching keyring derives the same addresses without the phrase', () => {
  const spending = new PracticeKeyring(TEST_MNEMONIC);
  const watching = PracticeKeyring.watching(spending.accountXpub());
  for (const change of [false, true]) {
    for (const index of [0, 1, 19]) {
      assert.equal(
        watching.addressAt(change, index).address,
        spending.addressAt(change, index).address,
      );
    }
  }
});

test('a watching keyring cannot produce a key that spends', () => {
  const watching = PracticeKeyring.watching(new PracticeKeyring(TEST_MNEMONIC).accountXpub());
  assert.throws(() => watching.privateKeyAt(false, 0), /only watches/);
});

test('a watching keyring refuses an extended private key', () => {
  // Handing it the spending key by mistake must fail loudly, not silently
  // give the console the ability to move the float.
  const xprv = HDKey.fromMasterSeed(mnemonicToSeedSync(TEST_MNEMONIC, ''))
    .derive(PRACTICE_DERIVATION_ACCOUNT).privateExtendedKey;
  assert.throws(() => PracticeKeyring.watching(xprv), /extended PRIVATE key|not an account key/);
  assert.throws(() => PracticeKeyring.watching(''), /without an extended public key/);
  assert.throws(() => PracticeKeyring.watching('not-a-key'), /not an account key/);
});
