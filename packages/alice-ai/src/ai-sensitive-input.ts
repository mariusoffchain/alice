import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const WORDLIST = new Set<string>(wordlist);
const BIP39_LENGTHS = new Set([12, 15, 18, 21, 24]);

const PRIVATE_KEY_PATTERNS = [
  /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,51}\b/,
  /\b(?:xprv|yprv|zprv|tprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{80,}\b/i,
];

export type SensitiveInputBlock = {
  kind: 'recovery_phrase' | 'private_key';
  message: string;
};

export function detectSensitiveInput(text: string): SensitiveInputBlock | null {
  if (containsPrivateKey(text)) {
    return {
      kind: 'private_key',
      message: 'Sensitive wallet data was blocked before it could be sent to Alice. Never paste private keys into chat.',
    };
  }

  if (containsRecoveryPhrase(text)) {
    return {
      kind: 'recovery_phrase',
      message: 'Recovery phrase blocked before it could be sent to Alice. Alice will never ask for these words.',
    };
  }

  return null;
}

function containsPrivateKey(text: string): boolean {
  return PRIVATE_KEY_PATTERNS.some(pattern => pattern.test(text));
}

function containsRecoveryPhrase(text: string): boolean {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z]+/g) ?? [];

  for (const length of BIP39_LENGTHS) {
    for (let start = 0; start + length <= words.length; start++) {
      const candidate = words.slice(start, start + length);
      if (candidate.every(word => WORDLIST.has(word))) {
        const phrase = candidate.join(' ');
        if (validateMnemonic(phrase, wordlist) || length >= 12) return true;
      }
    }
  }

  return false;
}
