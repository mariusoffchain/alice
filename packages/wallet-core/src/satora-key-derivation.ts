import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

const BIP85_XPRV_PATH = "m/83696968'/32'/0'";
const BIP85_HMAC_KEY = utf8ToBytes('bip-entropy-from-k');

/**
 * Derive the isolated BIP85 XPRV used exclusively by Satora swaps.
 *
 * This follows the BIP85 XPRV application at m/83696968'/32'/0'. The first
 * 32 bytes of BIP85 entropy are the chain code and the final 32 bytes are the
 * private key. The resulting XPRV is a depth-0 key, as required by BIP85 and
 * by Satora's `withXprv()` signer.
 */
export function deriveSatoraXprv(mnemonic: string): string {
  const normalizedMnemonic = mnemonic.trim().toLowerCase().normalize('NFKD');
  if (!normalizedMnemonic) {
    throw new Error('Cannot derive the Satora signer without the Alice mnemonic.');
  }

  const seed = mnemonicToSeedSync(normalizedMnemonic, '');
  const master = HDKey.fromMasterSeed(seed);
  let child: HDKey | undefined;
  let entropy: Uint8Array | undefined;
  let satoraRoot: HDKey | undefined;

  try {
    child = master.derive(BIP85_XPRV_PATH);
    const childPrivateKey = child.privateKey;
    if (!childPrivateKey) {
      throw new Error('BIP85 could not derive the Satora private key.');
    }

    entropy = hmac(sha512, BIP85_HMAC_KEY, childPrivateKey);
    satoraRoot = new HDKey({
      chainCode: entropy.slice(0, 32),
      privateKey: entropy.slice(32, 64),
      depth: 0,
      index: 0,
      parentFingerprint: 0,
    });
    return satoraRoot.privateExtendedKey;
  } finally {
    seed.fill(0);
    entropy?.fill(0);
    child?.wipePrivateData();
    master.wipePrivateData();
    satoraRoot?.wipePrivateData();
  }
}
