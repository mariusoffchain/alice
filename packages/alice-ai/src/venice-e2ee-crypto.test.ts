import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ATTESTATION_NONCE_BYTES,
  GCM_NONCE_BYTES,
  MIN_ENVELOPE_BYTES,
  PUBKEY_BYTES,
  VeniceE2EEError,
  assertUncompressedPublicKey,
  decryptEnvelope,
  deriveSharedKey,
  encryptToEnvelope,
  generateAttestationNonce,
  generateEphemeralKeyPair,
  parseEnvelope,
  wipeKey,
} from './venice-e2ee-crypto.ts';

describe('generateEphemeralKeyPair', () => {
  it('produces an uncompressed 65-byte public key starting with 04', () => {
    const { publicKey, publicKeyHex } = generateEphemeralKeyPair();
    assert.equal(publicKey.length, PUBKEY_BYTES);
    assert.equal(publicKey[0], 0x04);
    assert.equal(publicKeyHex.length, PUBKEY_BYTES * 2);
    assert.ok(publicKeyHex.startsWith('04'));
  });

  it('never repeats a key', () => {
    const a = generateEphemeralKeyPair();
    const b = generateEphemeralKeyPair();
    assert.notEqual(a.publicKeyHex, b.publicKeyHex);
  });
});

describe('generateAttestationNonce', () => {
  it('is exactly 32 bytes of hex, as Venice requires', () => {
    const nonce = generateAttestationNonce();
    assert.equal(nonce.length, ATTESTATION_NONCE_BYTES * 2);
    assert.match(nonce, /^[0-9a-f]{64}$/);
  });

  it('is fresh each call', () => {
    assert.notEqual(generateAttestationNonce(), generateAttestationNonce());
  });
});

describe('assertUncompressedPublicKey', () => {
  it('accepts a real uncompressed key', () => {
    const { publicKeyHex, publicKey } = generateEphemeralKeyPair();
    assert.deepEqual(assertUncompressedPublicKey(publicKeyHex), publicKey);
  });

  it('rejects non-hex, wrong length, and compressed keys', () => {
    const { publicKeyHex } = generateEphemeralKeyPair();
    assert.throws(() => assertUncompressedPublicKey('nothex!!'), VeniceE2EEError);
    assert.throws(() => assertUncompressedPublicKey('04ab'), VeniceE2EEError);
    // Compressed keys start with 02/03 and are half the length.
    assert.throws(() => assertUncompressedPublicKey('02' + publicKeyHex.slice(2, 66)), VeniceE2EEError);
    // Right length, wrong prefix.
    assert.throws(() => assertUncompressedPublicKey('05' + publicKeyHex.slice(2)), VeniceE2EEError);
  });
});

describe('deriveSharedKey', () => {
  it('is symmetric: both sides derive the same 32-byte key', () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();
    const fromAlice = deriveSharedKey(alice.secretKey, bob.publicKey);
    const fromBob = deriveSharedKey(bob.secretKey, alice.publicKey);
    assert.equal(fromAlice.length, 32);
    assert.deepEqual(fromAlice, fromBob);
  });

  it('gives a different key for a different peer', () => {
    const alice = generateEphemeralKeyPair();
    const bob = generateEphemeralKeyPair();
    const eve = generateEphemeralKeyPair();
    assert.notDeepEqual(
      deriveSharedKey(alice.secretKey, bob.publicKey),
      deriveSharedKey(alice.secretKey, eve.publicKey),
    );
  });
});

describe('encryptToEnvelope / decryptEnvelope', () => {
  it('round-trips a message through the model keypair', () => {
    // The TEE side: its attestation key decrypts what the client encrypted.
    const model = generateEphemeralKeyPair();
    const envelope = encryptToEnvelope(model.publicKey, 'What is a UTXO?');
    assert.equal(decryptEnvelope(model.secretKey, envelope), 'What is a UTXO?');
  });

  it('round-trips unicode and long text', () => {
    const model = generateEphemeralKeyPair();
    const text = 'Bitcoin ⚡, accents, émojis 🔐, and a fairly long sentence. '.repeat(20);
    const envelope = encryptToEnvelope(model.publicKey, text);
    assert.equal(decryptEnvelope(model.secretKey, envelope), text);
  });

  it('round-trips an empty message', () => {
    const model = generateEphemeralKeyPair();
    assert.equal(decryptEnvelope(model.secretKey, encryptToEnvelope(model.publicKey, '')), '');
  });

  it('produces a different envelope every time (fresh key and nonce)', () => {
    const model = generateEphemeralKeyPair();
    const a = encryptToEnvelope(model.publicKey, 'same text');
    const b = encryptToEnvelope(model.publicKey, 'same text');
    assert.notEqual(a, b);
    assert.notDeepEqual(parseEnvelope(a).peerPublicKey, parseEnvelope(b).peerPublicKey);
    assert.notDeepEqual(parseEnvelope(a).nonce, parseEnvelope(b).nonce);
  });

  it('cannot be decrypted with the wrong key', () => {
    const model = generateEphemeralKeyPair();
    const impostor = generateEphemeralKeyPair();
    const envelope = encryptToEnvelope(model.publicKey, 'secret');
    assert.throws(() => decryptEnvelope(impostor.secretKey, envelope), VeniceE2EEError);
  });

  it('rejects a tampered ciphertext (GCM tag must fail closed)', () => {
    const model = generateEphemeralKeyPair();
    const envelope = encryptToEnvelope(model.publicKey, 'do not tamper');
    // Flip the last byte of the ciphertext/tag.
    const flipped = envelope.slice(0, -2)
      + (envelope.slice(-2) === 'ff' ? '00' : 'ff');
    assert.throws(() => decryptEnvelope(model.secretKey, flipped), VeniceE2EEError);
  });

  it('does not leak the underlying cipher error', () => {
    const model = generateEphemeralKeyPair();
    const impostor = generateEphemeralKeyPair();
    const envelope = encryptToEnvelope(model.publicKey, 'secret');
    try {
      decryptEnvelope(impostor.secretKey, envelope);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof VeniceE2EEError);
      assert.equal((err as Error).message, 'Failed to decrypt response chunk.');
    }
  });
});

describe('parseEnvelope, fail closed on anything malformed', () => {
  it('splits a well-formed envelope at the right offsets', () => {
    const model = generateEphemeralKeyPair();
    const envelope = encryptToEnvelope(model.publicKey, 'hello');
    const parsed = parseEnvelope(envelope);
    assert.equal(parsed.peerPublicKey.length, PUBKEY_BYTES);
    assert.equal(parsed.peerPublicKey[0], 0x04);
    assert.equal(parsed.nonce.length, GCM_NONCE_BYTES);
    assert.ok(parsed.ciphertext.length >= 16, 'ciphertext carries at least the GCM tag');
  });

  // The whole point: a Venice response that is NOT an envelope, most
  // importantly, one that is plaintext model output, must be rejected, never
  // rendered as if E2EE had happened.
  it('rejects plaintext model output', () => {
    assert.throws(() => parseEnvelope('A UTXO is an unspent transaction output.'), VeniceE2EEError);
  });

  it('rejects empty, non-hex and odd-length input', () => {
    assert.throws(() => parseEnvelope(''), VeniceE2EEError);
    assert.throws(() => parseEnvelope('zzzz'), VeniceE2EEError);
    assert.throws(() => parseEnvelope('04abc'), VeniceE2EEError);
  });

  it('rejects an envelope shorter than the minimum', () => {
    const short = '04' + 'ab'.repeat(MIN_ENVELOPE_BYTES - 2);
    assert.throws(() => parseEnvelope(short), VeniceE2EEError);
  });

  it('rejects an envelope whose embedded key is not uncompressed', () => {
    const model = generateEphemeralKeyPair();
    const envelope = encryptToEnvelope(model.publicKey, 'hello');
    const badPrefix = '02' + envelope.slice(2);
    assert.throws(() => parseEnvelope(badPrefix), VeniceE2EEError);
  });

  it('accepts uppercase hex', () => {
    const model = generateEphemeralKeyPair();
    const envelope = encryptToEnvelope(model.publicKey, 'case test');
    assert.equal(decryptEnvelope(model.secretKey, envelope.toUpperCase()), 'case test');
  });
});

describe('wipeKey', () => {
  it('zeroes the buffer', () => {
    const { secretKey } = generateEphemeralKeyPair();
    wipeKey(secretKey);
    assert.ok(secretKey.every(b => b === 0));
  });
});
