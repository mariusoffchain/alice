/**
 * The account's reachable address: writing it down, reading it back, and the
 * one preference that governs anything Alice sends beyond the essentials.
 *
 * Two things are kept for the same address and they do different jobs. The
 * HMAC in `user_identities` answers "is this the person who owns this account",
 * and is what a sign-in matches on, which is why logging in never opens the
 * vault. The ciphertext here answers "where do I write", and is opened only
 * when there is something to send.
 *
 * See email-vault.ts for what the encryption does and, more importantly, what
 * it does not do.
 */

import type { Env } from './index.ts';
import { decryptEmail, emailVaultConfigured, encryptEmail, maskEmail } from './email-vault.ts';

export type AccountEmail = {
  email: string;
  masked: string;
  product_updates: boolean;
};

/**
 * Write down where this account can be reached.
 *
 * Called on every successful code login, which quietly repairs the accounts
 * created back when nothing was stored: the user types their address to log in
 * anyway, so there is nothing to ask and nothing to interrupt.
 *
 * Product mail starts on. Alice writes a few times a year to say what the app
 * can now do, and asking permission for that with a switch nobody moves was
 * clutter dressed as respect. The column stays, and the ON CONFLICT still
 * leaves it alone on rewrite, because the day a product mail goes out it must
 * carry a way to stop it: that link needs somewhere to write "no", and this is
 * it. Someone who turns it off must never find it back on by signing in from a
 * new phone.
 */
export async function rememberAccountEmail(
  env: Env,
  userId: string,
  email: string,
  options: { verified: boolean; now?: number } = { verified: false },
): Promise<void> {
  if (!emailVaultConfigured(env)) return;
  const now = options.now ?? Date.now();
  const ciphertext = await encryptEmail(env, email);
  await env.ACCOUNT_DB.prepare(`
    INSERT INTO account_emails (
      user_id, email_ciphertext, email_masked, verified_at, product_updates,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      email_ciphertext = excluded.email_ciphertext,
      email_masked = excluded.email_masked,
      verified_at = COALESCE(excluded.verified_at, account_emails.verified_at),
      updated_at = excluded.updated_at
  `).bind(
    userId,
    ciphertext,
    maskEmail(email),
    options.verified ? now : null,
    now,
    now,
  ).run();
}

/** The masked label, for showing an account holder which address is on file. */
export async function accountEmailMasked(
  env: Env,
  userId: string,
): Promise<{ masked: string; product_updates: boolean } | null> {
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT email_masked, product_updates FROM account_emails WHERE user_id = ?
  `).bind(userId).first<{ email_masked: string; product_updates: number }>();
  if (!row) return null;
  return { masked: row.email_masked, product_updates: row.product_updates === 1 };
}

/** The address itself. Only ever called when there is something to send. */
export async function loadAccountEmail(
  env: Env,
  userId: string,
): Promise<AccountEmail | null> {
  const row = await env.ACCOUNT_DB.prepare(`
    SELECT email_ciphertext, email_masked, product_updates
    FROM account_emails WHERE user_id = ?
  `).bind(userId).first<{
    email_ciphertext: string;
    email_masked: string;
    product_updates: number;
  }>();
  if (!row) return null;
  const email = await decryptEmail(env, row.email_ciphertext);
  if (!email) return null;
  return {
    email,
    masked: row.email_masked,
    product_updates: row.product_updates === 1,
  };
}

/**
 * The one thing left to choose.
 *
 * A plan about to lapse is transactional: it concerns something the user paid
 * for and it is sent whether or not this is on. This governs the rest, the
 * occasional product mail, and it starts off because nobody asked for it.
 */
export async function setProductUpdates(
  env: Env,
  userId: string,
  enabled: boolean,
  now = Date.now(),
): Promise<void> {
  await env.ACCOUNT_DB.prepare(`
    UPDATE account_emails SET product_updates = ?, updated_at = ? WHERE user_id = ?
  `).bind(enabled ? 1 : 0, now, userId).run();
}
