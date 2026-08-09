# Recovery Bundle design

Status: design only, not implemented.

## Objective

The Recovery Bundle carries only wallet recovery metadata that cannot reliably be reconstructed from the seed or network providers. It is created and imported locally, without an Alice account or storage server.

## Scope

The first version should include:

- pending and refundable swap records;
- contract signing descriptors required to spend or refund;
- preimages and refund material when required by the payment rail;
- provider identifiers and enough status metadata to resume reconciliation;
- the network and wallet fingerprint needed to reject a bundle for another wallet.

Settled transaction history, Alice discussions, preferences, cached balances, and model files should not be included.

## Cryptographic format

The bundle should use a versioned container encrypted with a wallet-derived 32-byte key and a domain separator such as `alice/recovery-bundle/v1`. The seed itself is never written into the bundle.

The outer container should contain only:

```json
{
  "format": "alice-recovery-bundle",
  "version": 1,
  "network": "mutinynet",
  "algorithm": "AES-256-GCM",
  "nonce": "base64",
  "ciphertext": "base64"
}
```

The format, version, and network must be authenticated as additional data. The encrypted payload should include the wallet fingerprint, creation time, repository schema versions, and recovery records.

## Export flow

1. Query every payment rail for pending or refundable recovery records.
2. Normalize them into a versioned internal schema.
3. Validate that required descriptors and secrets are present.
4. Encrypt and authenticate the payload locally.
5. Let the user save or share the resulting file through the operating system.
6. Display the number and status of included swaps, never their secrets.

## Import flow

1. Read and validate the container version and network.
2. Derive the scoped key from the imported wallet.
3. Decrypt and authenticate the payload.
4. Verify the wallet fingerprint and every record schema.
5. Merge by stable IDs without replacing newer valid local state.
6. Refresh provider status before resuming or offering a refund.
7. Report imported, skipped, conflicted, and invalid record counts.

## Safety requirements

- Never allow a bundle for another wallet or network to be imported.
- Never overwrite a newer pending or refundable record silently.
- Never mark a payment settled based only on bundle contents.
- Never delete the user's local recovery records after export.
- Block destructive wallet reset while unresolved swaps exist unless the user has settled, refunded, or explicitly exported and verified a Recovery Bundle.
- Test native SQLite, IndexedDB, and Cache Storage repository adapters against the same export/import fixtures.
