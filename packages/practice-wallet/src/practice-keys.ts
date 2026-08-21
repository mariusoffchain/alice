import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { p2wpkh, TEST_NETWORK } from '@scure/btc-signer';

/**
 * Key derivation for the Mutinynet practice wallet.
 *
 * BIP84 native segwit on the test-networks coin type (m/84'/1'/0'). Mutinynet
 * is a signet fork, so its addresses share the `tb1` prefix and network
 * parameters with testnet/signet. The practice mnemonic is fully independent
 * from the main Alice wallet mnemonic.
 */
export const PRACTICE_DERIVATION_ACCOUNT = "m/84'/1'/0'";

export type PracticeAddressInfo = {
  address: string;
  path: string;
  publicKey: Uint8Array;
  change: boolean;
  index: number;
};

function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().normalize('NFKD');
}

/** Fresh 12-word practice mnemonic (BIP39, 128 bits of entropy). */
export function generatePracticeMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

/** The BIP39 english wordlist, for backup verification decoys. */
export const PRACTICE_WORDLIST: readonly string[] = wordlist;

/**
 * Extended-key version bytes for the test networks. @scure/bip32 defaults to
 * mainnet, so a tpub has to say which chain it belongs to.
 */
const TESTNET_BIP32_VERSIONS = { private: 0x04358394, public: 0x043587cf };

export class PracticeKeyring {
  private readonly account: HDKey;

  /**
   * A keyring that can look but not touch, built from the account's extended
   * public key instead of its recovery phrase.
   *
   * This exists so that reading a balance never requires the ability to spend
   * it. The admin console watches the faucet's float through one of these: it
   * derives the same addresses, and asking it for a private key throws.
   */
  static watching(accountXpub: string): PracticeKeyring {
    const trimmed = accountXpub.trim();
    if (!trimmed) {
      throw new Error('Cannot build a watching keyring without an extended public key.');
    }
    let account: HDKey;
    try {
      account = HDKey.fromExtendedKey(trimmed, TESTNET_BIP32_VERSIONS);
    } catch {
      // Keys exported by other tools may carry mainnet version bytes even on a
      // test network. The derivation is the same, so accept them too.
      try {
        account = HDKey.fromExtendedKey(trimmed);
      } catch {
        throw new Error('That is not an account key. It should start with tpub or xpub.');
      }
    }
    if (account.privateKey) {
      throw new Error('That is an extended PRIVATE key. A watching keyring takes the public one.');
    }
    return new PracticeKeyring(account);
  }

  constructor(mnemonic: string | HDKey) {
    if (mnemonic instanceof HDKey) {
      this.account = mnemonic;
      return;
    }
    const normalized = normalizeMnemonic(mnemonic);
    if (!normalized) {
      throw new Error('Cannot build the practice keyring without a mnemonic.');
    }
    const seed = mnemonicToSeedSync(normalized, '');
    // Testnet version bytes so the account serializes as a tpub rather than an
    // xpub. They are serialization metadata only: the keys and the addresses
    // they derive are identical either way.
    this.account = HDKey.fromMasterSeed(seed, TESTNET_BIP32_VERSIONS)
      .derive(PRACTICE_DERIVATION_ACCOUNT);
  }

  private node(change: boolean, index: number): HDKey {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid practice derivation index: ${index}.`);
    }
    return this.account.deriveChild(change ? 1 : 0).deriveChild(index);
  }

  addressAt(change: boolean, index: number): PracticeAddressInfo {
    const child = this.node(change, index);
    if (!child.publicKey) {
      throw new Error('Practice derivation produced no public key.');
    }
    const payment = p2wpkh(child.publicKey, TEST_NETWORK);
    if (!payment.address) {
      throw new Error('Practice derivation produced no address.');
    }
    return {
      address: payment.address,
      path: `${PRACTICE_DERIVATION_ACCOUNT}/${change ? 1 : 0}/${index}`,
      publicKey: child.publicKey,
      change,
      index,
    };
  }

  scriptAt(change: boolean, index: number): Uint8Array {
    const child = this.node(change, index);
    if (!child.publicKey) {
      throw new Error('Practice derivation produced no public key.');
    }
    return p2wpkh(child.publicKey, TEST_NETWORK).script;
  }

  /** The account's extended public key: enough to watch, never to spend. */
  accountXpub(): string {
    return this.account.publicExtendedKey;
  }

  privateKeyAt(change: boolean, index: number): Uint8Array {
    const child = this.node(change, index);
    if (!child.privateKey) {
      throw new Error(
        'This keyring only watches: it was built from an extended public key and holds no private key.',
      );
    }
    return child.privateKey;
  }
}
