// Wallet derivation for the xpub / descriptor view. A user pastes either an
// extended public key (xpub / ypub / zpub and their testnet forms) or a full
// output descriptor (single-sig, multisig, taproot, miniscript). Both are
// reduced to one or two ranged descriptors (receive on chain 0, change on
// chain 1) that address derivation walks by index.
//
// Read-only by construction: only the *public* key material is ever handled,
// and @bitcoinerlab/descriptors derives addresses, it never signs. The key
// stays in the browser; nothing here touches the network (that is wallet-scan).

import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import * as descriptors from '@bitcoinerlab/descriptors';
import type { ScriptType } from './types.ts';

const b58 = base58check(sha256);

// The bitcoinjs network params the descriptor library needs. Signet, testnet4
// and mutinynet all share Bitcoin testnet address parameters, so they map to
// the same object; only mainnet differs.
export type DeriveNetwork = 'bitcoin' | 'testnet';

function networkParams(net: DeriveNetwork) {
  return net === 'bitcoin' ? descriptors.networks.bitcoin : descriptors.networks.testnet;
}

// Map a Explorer networkId to the derivation network. Only mainnet is its
// own; every test network uses testnet parameters.
export function deriveNetworkFor(networkId: string): DeriveNetwork {
  return networkId === 'mainnet' ? 'bitcoin' : 'testnet';
}

// SLIP-0132 version bytes. An extended key's four-byte prefix encodes both the
// network and the intended script type; we rewrite it to the plain xpub/tpub
// prefix (descriptors always carry xpub/tpub, the wrapper says the script).
const XPUB_VERSIONS: Record<string, { net: DeriveNetwork; script: ScriptType; canonical: number }> = {
  // mainnet
  '0488b21e': { net: 'bitcoin', script: 'p2pkh', canonical: 0x0488b21e },   // xpub  BIP44
  '049d7cb2': { net: 'bitcoin', script: 'p2sh', canonical: 0x0488b21e },    // ypub  BIP49
  '04b24746': { net: 'bitcoin', script: 'p2wpkh', canonical: 0x0488b21e },  // zpub  BIP84
  '02aa7ed3': { net: 'bitcoin', script: 'p2wsh', canonical: 0x0488b21e },   // Zpub  multisig
  // testnet
  '043587cf': { net: 'testnet', script: 'p2pkh', canonical: 0x043587cf },   // tpub
  '044a5262': { net: 'testnet', script: 'p2sh', canonical: 0x043587cf },    // upub
  '045f1cf6': { net: 'testnet', script: 'p2wpkh', canonical: 0x043587cf },  // vpub
  '02575483': { net: 'testnet', script: 'p2wsh', canonical: 0x043587cf },   // Vpub  multisig
};

export class WalletInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletInputError';
  }
}

/** One wallet, reduced to the descriptors address derivation walks. */
export type WalletDescriptor = {
  /** Chain 0 (external / receive), a ranged descriptor ending in /*. */
  receive: string;
  /** Chain 1 (internal / change), when the input implies one. */
  change?: string;
  /** The dominant script type, for the card and per-address labels. */
  scriptHint: ScriptType;
  /** Which network the key belongs to, derived from its prefix or the tab. */
  network: DeriveNetwork;
  /** A short, human descriptor kind for display. */
  kind: 'xpub' | 'descriptor';
};

// Every extended-key prefix we normalise: mainnet x/y/z and multisig Y/Z, plus
// the testnet t/u/v and multisig U/V forms. The version bytes are the real
// check (toCanonicalXpub); this just decides "treat as a key, not a descriptor".
const EXT_KEY_RE = /^(xpub|ypub|zpub|Ypub|Zpub|tpub|upub|vpub|Upub|Vpub)[1-9A-HJ-NP-Za-km-z]+$/;

/** Rewrite an extended key's version bytes to the canonical xpub/tpub prefix. */
function toCanonicalXpub(extKey: string): { xpub: string; script: ScriptType; net: DeriveNetwork } {
  let raw: Uint8Array;
  try {
    raw = b58.decode(extKey);
  } catch {
    throw new WalletInputError('This does not look like a valid extended key.');
  }
  if (raw.length !== 78) throw new WalletInputError('Extended key has an unexpected length.');
  const prefix = Array.from(raw.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
  const meta = XPUB_VERSIONS[prefix];
  if (!meta) throw new WalletInputError('Unrecognised extended-key type.');
  const rewritten = new Uint8Array(raw);
  rewritten[0] = (meta.canonical >>> 24) & 0xff;
  rewritten[1] = (meta.canonical >>> 16) & 0xff;
  rewritten[2] = (meta.canonical >>> 8) & 0xff;
  rewritten[3] = meta.canonical & 0xff;
  return { xpub: b58.encode(rewritten), script: meta.script, net: meta.net };
}

// The standard single-sig descriptor for an extended key, per its script type.
function wrapExtendedKey(xpub: string, script: ScriptType, chain: 0 | 1): string {
  const path = `${xpub}/${chain}/*`;
  switch (script) {
    case 'p2pkh': return `pkh(${path})`;
    case 'p2sh': return `sh(wpkh(${path}))`;
    case 'p2wpkh': return `wpkh(${path})`;
    default: return `wpkh(${path})`;
  }
}

// The outer script function of a descriptor, for the display hint only.
function scriptHintOf(descriptor: string): ScriptType {
  const d = descriptor.trim();
  if (d.startsWith('tr(')) return 'p2tr';
  if (d.startsWith('wpkh(')) return 'p2wpkh';
  if (d.startsWith('pkh(')) return 'p2pkh';
  if (d.startsWith('wsh(')) return d.includes('multi(') ? 'multisig' : 'p2wsh';
  if (d.startsWith('sh(')) return d.includes('wpkh') ? 'p2sh' : 'multisig';
  return 'unknown';
}

/** Strip an optional `#checksum` suffix; we recompute on demand, and multipath
 *  splitting would invalidate a provided one anyway. */
function stripChecksum(descriptor: string): string {
  const hash = descriptor.indexOf('#');
  return hash === -1 ? descriptor : descriptor.slice(0, hash);
}

/**
 * Parse a pasted wallet input (extended key or descriptor) into the ranged
 * descriptors to scan. Throws WalletInputError with a plain message on anything
 * malformed. `fallbackNetwork` decides the network when the input alone cannot
 * (a raw descriptor with a bare xpub carries no network hint of its own).
 */
export function parseWalletInput(input: string, fallbackNetwork: DeriveNetwork): WalletDescriptor {
  const trimmed = input.trim();
  if (!trimmed) throw new WalletInputError('Enter an extended public key or a descriptor.');

  // A bare extended key: normalise and wrap into the standard descriptors.
  if (EXT_KEY_RE.test(trimmed)) {
    const { xpub, script, net } = toCanonicalXpub(trimmed);
    return {
      receive: wrapExtendedKey(xpub, script, 0),
      change: wrapExtendedKey(xpub, script, 1),
      scriptHint: script,
      network: net,
      kind: 'xpub',
    };
  }

  // Otherwise treat it as an output descriptor. Some wallets wrap the export
  // across lines or pad it with spaces; a descriptor has no significant
  // whitespace, so strip it all before parsing.
  const body = stripChecksum(trimmed).replace(/\s+/g, '');
  if (!/^(pk|pkh|wpkh|sh|wsh|tr|combo|addr|raw|multi|sortedmulti)\(/.test(body)) {
    throw new WalletInputError('Not a recognised extended key or descriptor.');
  }
  if (!body.includes('*')) {
    throw new WalletInputError('Descriptor must be ranged (end its path with /*).');
  }

  // A multipath descriptor names the receive and change chains at once, written
  // `<0;1>` (BIP389) or `{0,1}` by some wallets. Expand it into the two single
  // paths address derivation walks; a single path is receive only.
  const multipath = body.match(/[<{](\d+)[;,](\d+)[>}]/);
  let receive: string;
  let change: string | undefined;
  if (multipath) {
    const rx = /[<{]\d+[;,]\d+[>}]/g;
    receive = body.replace(rx, multipath[1]);
    change = body.replace(rx, multipath[2]);
  } else {
    receive = body;
  }

  const network = fallbackNetwork;
  // Validate by deriving index 0; a bad descriptor throws here with a clear cause.
  try {
    deriveAddress(receive, 0, network);
  } catch (err) {
    throw new WalletInputError(
      err instanceof Error ? `Descriptor could not be parsed: ${err.message}` : 'Descriptor could not be parsed.',
    );
  }

  return { receive, change, scriptHint: scriptHintOf(body), network, kind: 'descriptor' };
}

const { Output } = descriptors.DescriptorsFactory(descriptors.ecc);

/** The address at a given index of a ranged descriptor. Pure, no network. */
export function deriveAddress(descriptor: string, index: number, network: DeriveNetwork): string {
  const out = new Output({ descriptor: stripChecksum(descriptor), index, network: networkParams(network) });
  return out.getAddress();
}

/** A contiguous run of addresses [from, from+count) of a ranged descriptor. */
export function deriveChain(
  descriptor: string,
  from: number,
  count: number,
  network: DeriveNetwork,
): { index: number; address: string }[] {
  const out: { index: number; address: string }[] = [];
  for (let i = from; i < from + count; i += 1) {
    out.push({ index: i, address: deriveAddress(descriptor, i, network) });
  }
  return out;
}
