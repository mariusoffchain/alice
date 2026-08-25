/**
 * The one place an account's email address is kept, and the only key that
 * opens it.
 *
 * Alice used to store nothing but `hmac(email)` and a mask, which made her
 * structurally unable to write to anyone. That was deliberate, and it has been
 * deliberately changed: an account is now expected to carry a reachable
 * address, because a plan that cannot renew itself has to be able to warn its
 * holder, and because a product with no way to reach its users can only
 * apologise after the fact.
 *
 * What the encryption does, stated plainly so nobody mistakes it for more:
 *
 * - it protects the addresses if the database, a backup or an export leaks;
 * - it does not hide them from the Worker, which holds the key and decrypts to
 *   send;
 * - it therefore does not put them out of reach of whoever can compel the
 *   people who run the Worker.
 *
 * That is why the interface encourages an alias rather than promising secrecy
 * it cannot deliver. The HMAC lookup stays alongside: it is what logs a user in
 * without the ciphertext ever being read, so a sign-in never needs to open the
 * vault.
 */

import type { Env } from './index.ts';
import { AccountHttpError } from './account.ts';

/**
 * The label shown back to an account holder.
 *
 * The local part is destroyed on purpose: it is enough to recognise your own
 * address, and not enough for someone reading over your shoulder, or reading a
 * support ticket, to learn it.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const visible = local.length <= 1 ? local : local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, Math.min(6, local.length - visible.length)))}@${domain}`;
}

/**
 * The secret behind the vault.
 *
 * `ACCOUNT_EMAIL_KEY` is the name; `BILLING_EMAIL_KEY` is honoured because it
 * held this exact role before addresses became an account-wide affair, and
 * silently failing to read rows written under the old name would lock users out
 * of their own reminders.
 */
function keyMaterial(env: Env): string {
  const key = (env.ACCOUNT_EMAIL_KEY ?? env.BILLING_EMAIL_KEY)?.trim();
  if (!key) {
    throw new AccountHttpError(
      503,
      'account_email_unavailable',
      'Alice accounts are not fully configured.',
    );
  }
  return key;
}

export function emailVaultConfigured(env: Env): boolean {
  return Boolean((env.ACCOUNT_EMAIL_KEY ?? env.BILLING_EMAIL_KEY)?.trim());
}

async function vaultKey(env: Env): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(keyMaterial(env)),
  );
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** AES-GCM, fresh nonce per address, nonce packed in front of the ciphertext. */
export async function encryptEmail(env: Env, email: string): Promise<string> {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    await vaultKey(env),
    new TextEncoder().encode(email),
  ));
  const packed = new Uint8Array(nonce.length + ciphertext.length);
  packed.set(nonce);
  packed.set(ciphertext, nonce.length);
  return toBase64(packed);
}

/**
 * Returns null rather than throwing on anything unreadable.
 *
 * A row encrypted under a rotated or mistyped key must not take down the job
 * that walks the table: one address nobody can read is a lost reminder, an
 * exception thrown mid-loop is every reminder after it.
 */
export async function decryptEmail(env: Env, packed: string): Promise<string | null> {
  try {
    const bytes = fromBase64(packed);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await vaultKey(env),
      bytes.slice(12),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
