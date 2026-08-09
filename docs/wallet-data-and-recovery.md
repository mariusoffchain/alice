# Wallet data and recovery

Alice is self-custodial. Alice does not keep a server-side copy of a user's seed, discussion history, transaction cache, or swap recovery records.

## What the seed restores

Importing the seed restores the wallet identity and the funds that the supported networks can rediscover. It does not recreate every record that existed only in a browser or on a device.

Transaction history is maintained as a local cache and refreshed from wallet providers where possible. A restored wallet may therefore rebuild part of its history progressively rather than displaying an identical device-local database immediately.

Pending or refundable swaps are different. Their local records can include preimages, refund data, contract metadata, and provider state that cannot be assumed to derive from the seed. Users should settle or refund pending swaps before resetting Alice, clearing site data, or moving the wallet to another browser.

## Alice discussions

Alice discussions stay on the device and are not synchronized by Alice. Alice Desktop encrypts its local conversations and session index with a random key held by the operating system keychain. This desktop protection must not be presented as already available on every browser or mobile backend.

- Alice keeps up to 50 conversations.
- Saving a 51st conversation removes the oldest one.
- Customize Alice shows the current count and approximate local size.
- The user can delete the 10 oldest conversations.
- The user can keep only the 10 newest conversations.
- The user can delete every conversation.

When a user asks Alice about local discussion storage, the app may provide the model with a minimal device-local summary containing only the number of conversations, the 50-conversation limit, and an approximate byte count. It does not send discussion text as part of that summary.

## Transaction display

The History screen displays transactions in batches of 25 and loads the next batch when the user reaches the bottom. This limits rendered rows and keeps long histories responsive. The underlying local repository remains the source of the complete available history.

## Planned protection and portability

Conversation encryption is implemented for Alice Desktop. Native wallet adapters and a Recovery Bundle for swap metadata still require separate implementation and review. They must not be represented as available before that work is complete.

The Recovery Bundle should be:

- generated locally;
- encrypted with a user-controlled secret;
- exportable and importable without an Alice account or Alice server;
- limited to the recovery data that cannot be reconstructed safely from the seed;
- versioned and authenticated so corrupt or modified bundles are rejected;
- explicit about pending and refundable swaps before destructive wallet operations.

Conversation encryption must preserve existing discussions through a tested migration, use a key that is not stored beside the ciphertext in equivalent plaintext form, and work across native and web storage backends.
