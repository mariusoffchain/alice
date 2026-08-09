# Local chat encryption design

Status: implemented for Alice Desktop. The shared adapter contract is ready for future native wallet implementations.

## Objective

Alice discussions must remain local while becoming unreadable at rest without access to the wallet secret. The design must work without an Alice account, synchronization server, or mandatory PIN.

## Key model

Alice Desktop has no wallet seed and must not gain access to one. Its Rust/Tauri layer generates a random 32-byte key and stores it in the operating system keychain under the Alice Desktop application identity. The key never crosses the Tauri command boundary into JavaScript.

The native layer reads the keychain once per app session, keeps the key in zeroizing process memory, and reuses it for every conversation value. This limits operating system authorization to the first access instead of prompting once per stored record.

The shared `ChatStorageCipher` adapter gives `ChatProvider` only `encrypt` and `decrypt` operations bound to a storage context. Future wallet-native implementations can provide a wallet-derived key without making `alice-ai` import Wallet Core or receive the seed.

## Record format

Each desktop conversation is stored as a versioned authenticated-encryption envelope:

```text
alice-chat-encrypted:v1:v1:<base64 nonce-and-ciphertext>
```

The AsyncStorage key is authenticated as additional data. Every write uses a fresh random nonce. The session index is encrypted too, so titles, timestamps, and message counts are not left in plaintext.

## Migration

1. Detect the existing plaintext index and session records.
2. Open or create the desktop key in the system keychain.
3. Encrypt and verify each plaintext session before replacing it.
4. Encrypt and verify the index after the sessions.
5. Accept mixed encrypted/plaintext state so an interrupted migration resumes safely.

Authentication failures stop reads and writes rather than replacing protected data with an empty history.

## Tests required before release

- ciphertext never contains titles or message excerpts;
- a different wallet cannot decrypt the records;
- wrong or modified ciphertext fails closed;
- every write uses a distinct nonce;
- migration preserves all valid messages and variants;
- interrupted migration resumes safely;
- cleanup operations work before and after migration;
- future web, iOS, and Android storage adapters pass the same contract tests.
