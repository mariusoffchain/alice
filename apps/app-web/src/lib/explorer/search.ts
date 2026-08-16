// Universal search classification: decide, from a pasted string alone, whether
// it is a transaction id, a block (height or hash), an address, or an xpub.
// Pure and format-only; whether the thing exists is answered by the provider.

export type SearchKind = 'tx' | 'block' | 'address' | 'xpub' | 'unknown';
export type SearchResult = { kind: SearchKind; value: string };

const HEX64 = /^[0-9a-fA-F]{64}$/;
const HEIGHT = /^\d{1,8}$/; // block heights are well under 100,000,000
const BASE58_ADDR = /^[13][a-km-zA-HJ-NP-Z1-9]{24,33}$/; // P2PKH / P2SH
const BECH32_ADDR = /^(bc1|tb1|bcrt1)[0-9ac-hj-np-z]{6,87}$/i; // segwit / taproot
const XPUB_PREFIX = /^(xpub|ypub|zpub|tpub|upub|vpub)/i;
// An Arkade (off-chain VTXO) address; recognised only when the caller opts in,
// so pasting one on a plain Bitcoin network stays a format error.
const ARK_ADDR = /^(ark|tark)1[0-9ac-hj-np-z]{6,120}$/i;
// Liquid addresses, opt-in the same way: bech32/blech32 (ex1 unconfidential,
// lq1 confidential) and the base58 prefixes (Q/G/H unconfidential, V
// confidential legacy).
const LIQUID_BECH32 = /^(ex1|lq1)[0-9ac-hj-np-z]{6,120}$/i;
const LIQUID_BASE58 = /^[GHQV][a-km-zA-HJ-NP-Z1-9]{25,110}$/;
// An output descriptor: a script function wrapping a ranged key path. Routed to
// the same wallet view as an extended key.
const DESCRIPTOR = /^(sh|wsh|pk|pkh|wpkh|tr|combo|addr|raw|multi|sortedmulti)\(.*\*.*\)/;

export function classifySearch(raw: string, opts: { arkAddresses?: boolean; liquidAddresses?: boolean } = {}): SearchResult {
  const s = raw.trim();
  if (!s) return { kind: 'unknown', value: s };

  // On the Arkade network, an ark1… address routes to the VTXO address view.
  if (opts.arkAddresses && ARK_ADDR.test(s)) return { kind: 'address', value: s.toLowerCase() };

  // On Liquid, its own address formats are addresses too.
  if (opts.liquidAddresses) {
    if (LIQUID_BECH32.test(s)) return { kind: 'address', value: s.toLowerCase() };
    if (LIQUID_BASE58.test(s)) return { kind: 'address', value: s };
  }

  // An output descriptor, before the single-token checks below.
  if (DESCRIPTOR.test(s.replace(/\s+/g, ''))) return { kind: 'xpub', value: s };

  // Pure digits: a block height.
  if (HEIGHT.test(s)) return { kind: 'block', value: s };

  // 64 hex: a txid or a block hash. A block hash carries a long run of leading
  // zeros (the proof of work); a txid effectively never does. Eight zeros is a
  // safe cut, far beyond what any real txid shows.
  if (HEX64.test(s)) {
    const leadingZeros = s.match(/^0+/)?.[0].length ?? 0;
    return { kind: leadingZeros >= 8 ? 'block' : 'tx', value: s.toLowerCase() };
  }

  // Extended public keys, checked before addresses (different first letters).
  if (XPUB_PREFIX.test(s)) return { kind: 'xpub', value: s };

  if (BECH32_ADDR.test(s)) return { kind: 'address', value: s.toLowerCase() };
  if (BASE58_ADDR.test(s)) return { kind: 'address', value: s };

  return { kind: 'unknown', value: s };
}
