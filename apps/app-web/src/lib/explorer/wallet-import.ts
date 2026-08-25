// Pull a usable wallet input (an extended key, an output descriptor, or a plain
// address) out of arbitrary imported text: a pasted string, a QR payload, or the
// contents of a wallet-export file. Pure and format-only; whether the thing has
// funds is answered later by the scan.
//
// Handles the common shapes: a bare token, a `bitcoin:` payment URI, and the
// JSON exports wallets produce (ColdCard, Sparrow, Electrum, generic
// `{descriptor: "..."}`), where the key sits somewhere in the object tree.

import { classifySearch } from './search.ts';

const EXT_KEY_RE = /\b([xyzXYZtuvTUV]pub[1-9A-HJ-NP-Za-km-z]{100,120})\b/;
const DESCRIPTOR_RE = /\b(?:sh|wsh|pk|pkh|wpkh|tr|combo|addr|raw|multi|sortedmulti)\([^\s]*\*[^\s]*\)(?:#[a-z0-9]{8})?/;

/** True when a string looks like an output descriptor with a derivation range. */
function looksLikeDescriptor(s: string): boolean {
  return /^(sh|wsh|pk|pkh|wpkh|tr|combo|addr|raw|multi|sortedmulti)\(/.test(s) && s.includes('*');
}

/** Validate a candidate token as something the wallet view can open. */
function isUsable(token: string): boolean {
  if (looksLikeDescriptor(token)) return true;
  const kind = classifySearch(token).kind;
  return kind === 'xpub' || kind === 'address';
}

// Walk a parsed JSON value for the first usable token: descriptor strings first
// (they carry the script type), then extended keys, then addresses.
function searchJson(value: unknown, want: 'descriptor' | 'key'): string | null {
  if (typeof value === 'string') {
    if (want === 'descriptor' && looksLikeDescriptor(value.trim())) return value.trim();
    if (want === 'key') {
      const k = value.trim();
      const kind = classifySearch(k).kind;
      if (kind === 'xpub' || kind === 'address') return k;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const v of value) { const hit = searchJson(v, want); if (hit) return hit; }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) { const hit = searchJson(v, want); if (hit) return hit; }
    return null;
  }
  return null;
}

/**
 * Extract a wallet input from imported text. Returns the token, or null when
 * nothing recognisable is present. Order of preference: an explicit descriptor,
 * then an extended key, then a plain address.
 */
export function extractWalletInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // Whole string is already a usable token.
  if (isUsable(text)) return text;

  // A `bitcoin:` payment URI: the address is the path, before any `?params`.
  if (/^bitcoin:/i.test(text)) {
    const addr = text.slice('bitcoin:'.length).split('?')[0].trim();
    if (addr && classifySearch(addr).kind === 'address') return addr;
  }

  // A wallet-export JSON: search the tree, descriptor first.
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      return searchJson(parsed, 'descriptor') ?? searchJson(parsed, 'key');
    } catch {
      /* not JSON, fall through to loose scanning */
    }
  }

  // Loose scan: find the first descriptor, extended key, or address in free text.
  const desc = text.match(DESCRIPTOR_RE);
  if (desc && looksLikeDescriptor(desc[0])) return desc[0];
  const key = text.match(EXT_KEY_RE);
  if (key && classifySearch(key[1]).kind === 'xpub') return key[1];
  for (const token of text.split(/\s+/)) {
    if (classifySearch(token).kind === 'address') return token;
  }
  return null;
}
