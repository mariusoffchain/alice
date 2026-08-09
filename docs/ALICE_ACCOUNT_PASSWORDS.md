# Alice account usernames and passwords

Alice keeps the account credential system completely separate from the wallet.
No account password, username or server-side value is used to
derive, wrap, encrypt, decrypt, restore or export a wallet seed or wallet
private key.

## Account identifiers

- `user_id` is an opaque, immutable server identifier. It is not a login name
  and is not displayed publicly.
- `display_name` starts with the prefix entered during registration and can be
  changed independently.
- `username` uses `<prefix>.<suffix>#<4 digits>`.
- The server generates the 4-digit discriminator with Web Crypto randomness.
  It is not derived from the username, a hash, the installation or `user_id`.

Alice shuffles 15 built-in Wonderland suffixes before returning 5 suggestions.
Users can choose a suggestion, shuffle again or enter a valid custom suffix.
An old username remains reserved for 180 days after a change. Username changes
are limited to 1 every 30 days.

## Password storage

- Passwords must contain between 15 and 128 Unicode characters and no more than
  256 UTF-8 bytes.
- Alice does not impose composition rules.
- D1 stores only a unique 128-bit salt, the work factor and a
  PBKDF2-HMAC-SHA-256 result.
- New password hashes use scrypt with `N=32768`, `r=8`, and `p=3`.
- Existing PBKDF2-SHA-256 credentials remain readable for migration compatibility.
- Login errors do not reveal whether an email, username or password was wrong.
- Identifier and temporary IP-HMAC buckets rate-limit password attempts before
  the expensive password derivation runs.
- Automatic Cloudflare invocation logs are disabled and account request bodies
  are never included in Alice technical logs.

Every supported Alice account is verified with an email address at
registration. That email can recover the account through the existing email OTP
flow, then replace its password from the authenticated account screen. Password
recovery never recovers the wallet.

## Server data

Migration `0004_usernames_passwords.sql` adds:

- `users.username`, `users.display_name` and `users.username_updated_at`;
- `password_credentials`;
- `username_history`;
- a partial unique index on non-null usernames.

Deletion cascades remove password credentials and username history with the
Alice account. Expired username reservations are purged by the hourly account
cleanup.
