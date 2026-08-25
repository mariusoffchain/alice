// Venice E2EE cryptographic primitives.
//
// Pure functions only: no fetch, no storage, no React. That keeps them testable
// with `node --test` and identical across web, desktop and React Native, which
// is why AES-GCM comes from @noble/ciphers (pure JS) rather than Web Crypto,
// whose SubtleCrypto is not reliably available on React Native.
//
// Protocol, per Venice's TEE & E2EE guide:
//   - ephemeral secp256k1 keypair per message, uncompressed public key (65 B)
//   - ECDH against the model key from the TEE attestation
//   - HKDF-SHA256, no salt, info = "ecdsa_encryption", 32-byte output
//   - AES-256-GCM, 12-byte nonce, 16-byte tag
//   - envelope = hex( pubkey[65] || nonce[12] || ciphertext+tag )

import { getPublicKey, getSharedSecret, utils as secpUtils } from '@noble/secp256k1';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const PUBKEY_BYTES = 65;
export const GCM_NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;
/** Smallest possible envelope: keys + nonce + tag, with an empty ciphertext. */
export const MIN_ENVELOPE_BYTES = PUBKEY_BYTES + GCM_NONCE_BYTES + GCM_TAG_BYTES;

/** Venice requires the attestation nonce to be exactly 32 bytes / 64 hex chars. */
export const ATTESTATION_NONCE_BYTES = 32;

const HKDF_INFO = utf8ToBytes('ecdsa_encryption');
const RUNTIME_SELF_TEST_PUBLIC_KEY =
  '04c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
  + '1ae168fea63dc339a3c58419466ceaeef7f632653266d0e1236431a950cfe52a';
const RUNTIME_SELF_TEST_DERIVED_KEY =
  'f9c56075758216eed393c6f5b2bff7ef1cdddb796ecdedbef9385f972f89f894';
const RUNTIME_SELF_TEST_CIPHERTEXT =
  'e2c9e978eb8629a990da7259ec6f2007ec6851ddc87a71d697ec7919ba7dcf3df3896799623674';
const RUNTIME_SELF_TEST_LONG_CIPHERTEXT_HASH =
  '07fe1e5361d9231b9f1f2a068b4f60aeb368db80dae97b8a61d9bacf77b45433';
let runtimeSelfTestPassed = false;

export class VeniceE2EEError extends Error {
  readonly status?: number;
  readonly code?: string;
  /**
   * One line of closed-vocabulary technical cause, safe to show and to log:
   * see venice-failure.ts. Absent when nothing useful could be said.
   */
  readonly detail?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; detail?: string } = {},
  ) {
    super(message);
    this.name = 'VeniceE2EEError';
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
  }
}

export type EphemeralKeyPair = {
  /** 32-byte secret. */
  secretKey: Uint8Array;
  /** Uncompressed public key, 65 bytes, first byte 0x04. */
  publicKey: Uint8Array;
  publicKeyHex: string;
};

/** Fresh keypair. Request-message keys must never be reused. */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const secretKey = secpUtils.randomSecretKey();
  const publicKey = getPublicKey(secretKey, false);
  return { secretKey, publicKey, publicKeyHex: bytesToHex(publicKey) };
}

/** 32-byte hex nonce for the attestation request. */
export function generateAttestationNonce(): string {
  return bytesToHex(randomBytes(ATTESTATION_NONCE_BYTES));
}

/**
 * Venice rejects anything that is not an uncompressed secp256k1 point, so
 * validate before spending a round trip on it.
 */
export function assertUncompressedPublicKey(hex: string, label = 'public key'): Uint8Array {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized)) {
    throw new VeniceE2EEError(`Invalid ${label}: not hex.`);
  }
  if (normalized.length !== PUBKEY_BYTES * 2) {
    throw new VeniceE2EEError(
      `Invalid ${label}: expected ${PUBKEY_BYTES * 2} hex chars, got ${normalized.length}.`,
    );
  }
  if (!normalized.startsWith('04')) {
    throw new VeniceE2EEError(`Invalid ${label}: uncompressed keys must start with 04.`);
  }
  return hexToBytes(normalized);
}

/**
 * ECDH + HKDF-SHA256 -> 32-byte AES key.
 *
 * NOTE (needs live verification): secp256k1 ECDH yields a curve point; the
 * shared secret used here is its X coordinate (32 bytes), which is what
 * Python's `cryptography` exchange returns and what Venice's own examples are
 * built on. If a real Venice response ever fails to decrypt, this is the first
 * thing to re-check, the alternative convention is to feed the full
 * compressed point into HKDF.
 */
export function deriveSharedKey(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  const sharedPoint = getSharedSecret(secretKey, peerPublicKey, true);
  const sharedX = sharedPoint.slice(1);
  return hkdf(sha256, sharedX, undefined, HKDF_INFO, 32);
}

/**
 * Known-answer test for the exact primitives used by Venice. It catches a
 * broken JS crypto runtime before any encrypted prompt leaves the device.
 */
export function assertVeniceCryptoRuntime(): void {
  if (runtimeSelfTestPassed) return;
  const privateKey = new Uint8Array(32);
  privateKey[31] = 1;
  const publicKey = getPublicKey(privateKey, false);
  if (bytesToHex(publicKey) !== `04${'79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'}${'483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8'}`) {
    throw new VeniceE2EEError('The secp256k1 runtime failed its self-test.', {
      code: 'crypto_runtime_invalid',
    });
  }
  const derived = deriveSharedKey(privateKey, hexToBytes(RUNTIME_SELF_TEST_PUBLIC_KEY));
  if (bytesToHex(derived) !== RUNTIME_SELF_TEST_DERIVED_KEY) {
    throw new VeniceE2EEError('The ECDH/HKDF runtime failed its self-test.', {
      code: 'crypto_runtime_invalid',
    });
  }
  const ciphertext = gcm(derived, new Uint8Array(GCM_NONCE_BYTES))
    .encrypt(utf8ToBytes('Alice runtime self-test'));
  if (bytesToHex(ciphertext) !== RUNTIME_SELF_TEST_CIPHERTEXT) {
    throw new VeniceE2EEError('The AES-GCM runtime failed its self-test.', {
      code: 'crypto_runtime_invalid',
    });
  }
  const longCiphertext = gcm(derived, new Uint8Array(GCM_NONCE_BYTES))
    .encrypt(utf8ToBytes('a'.repeat(3000)));
  if (bytesToHex(sha256(longCiphertext)) !== RUNTIME_SELF_TEST_LONG_CIPHERTEXT_HASH) {
    throw new VeniceE2EEError('The AES-GCM runtime failed its long-message self-test.', {
      code: 'crypto_runtime_invalid',
    });
  }
  runtimeSelfTestPassed = true;
}

/**
 * Encrypt one message for the TEE. Its fresh public key is carried inside the
 * envelope so the enclave can derive this message's AES key. This keypair is
 * deliberately distinct from the response-session key advertised in the
 * X-Venice-TEE-Client-Pub-Key header.
 */
export function encryptToEnvelope(
  modelPublicKey: Uint8Array,
  plaintext: string,
): string {
  const ephemeral = generateEphemeralKeyPair();
  try {
    const key = deriveSharedKey(ephemeral.secretKey, modelPublicKey);
    const nonce = randomBytes(GCM_NONCE_BYTES);
    const ciphertext = gcm(key, nonce).encrypt(utf8ToBytes(plaintext));

    const envelope = new Uint8Array(PUBKEY_BYTES + GCM_NONCE_BYTES + ciphertext.length);
    envelope.set(ephemeral.publicKey, 0);
    envelope.set(nonce, PUBKEY_BYTES);
    envelope.set(ciphertext, PUBKEY_BYTES + GCM_NONCE_BYTES);
    return bytesToHex(envelope);
  } finally {
    wipeKey(ephemeral.secretKey);
  }
}

export type ParsedEnvelope = {
  peerPublicKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};

/**
 * Split a hex envelope. Rejects anything malformed rather than guessing, a
 * response that is not a valid envelope must fail closed, never be shown as if
 * it were plaintext output.
 */
export function parseEnvelope(hex: string): ParsedEnvelope {
  const normalized = hex.trim().toLowerCase();
  if (!normalized || !/^[0-9a-f]+$/.test(normalized)) {
    throw new VeniceE2EEError('Invalid envelope: not hex.');
  }
  if (normalized.length % 2 !== 0) {
    throw new VeniceE2EEError('Invalid envelope: odd hex length.');
  }
  const bytes = hexToBytes(normalized);
  if (bytes.length < MIN_ENVELOPE_BYTES) {
    throw new VeniceE2EEError(
      `Invalid envelope: ${bytes.length} bytes, expected at least ${MIN_ENVELOPE_BYTES}.`,
    );
  }
  if (bytes[0] !== 0x04) {
    throw new VeniceE2EEError('Invalid envelope: embedded key is not an uncompressed point.');
  }
  return {
    peerPublicKey: bytes.slice(0, PUBKEY_BYTES),
    nonce: bytes.slice(PUBKEY_BYTES, PUBKEY_BYTES + GCM_NONCE_BYTES),
    ciphertext: bytes.slice(PUBKEY_BYTES + GCM_NONCE_BYTES),
  };
}

/**
 * Decrypt one response chunk. Each chunk carries its own server ephemeral key,
 * so the shared key is derived per chunk.
 */
export function decryptEnvelope(clientSecretKey: Uint8Array, envelopeHex: string): string {
  const { peerPublicKey, nonce, ciphertext } = parseEnvelope(envelopeHex);
  const key = deriveSharedKey(clientSecretKey, peerPublicKey);
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, nonce).decrypt(ciphertext);
  } catch {
    // Never surface the underlying cipher error: it says nothing useful to a
    // user and a failed tag check is a security event, not a hint to act on.
    throw new VeniceE2EEError('Failed to decrypt response chunk.');
  }
  return new TextDecoder().decode(plaintext);
}

/**
 * Best-effort wipe of a secret key. JavaScript cannot guarantee this, the
 * garbage collector may already have copied the buffer, so it reduces the
 * window rather than closing it. Kept because Venice's guide asks for it, and
 * documented so nobody mistakes it for a hard guarantee.
 */
export function wipeKey(secretKey: Uint8Array): void {
  secretKey.fill(0);
}
