# Alice Closed Beta

Alice is currently in a closed mainnet beta. This build is intended for known
testers using a fresh wallet and small amounts only.

## Tested Release

- Version: `0.0.1`
- Android version code: `9`
- Source: tag `v0.0.1` in the public repository,
  <https://github.com/mariusoffchain/alice>
- APK SHA-256:
  `adab1d83ac355547d07cd37398ca6eb3c42cfb381b2e47aa1bf6bfcdac8ad207`

One honest caveat about that checksum: the APK now in circulation was built
before the source was published, so it cannot yet be reproduced from the tag,
which carries the publication fixes made since. From the next beta build the
APK is produced from the tagged tree, and this section states a checksum that
matches it.

Always verify the version and checksum supplied with the APK. Do not install an
APK forwarded by an unknown person.

## Available Surfaces

- Alice Web: <https://app.alicebtc.com>
- Alice mainnet beta: <https://wallet.alicebtc.com>
- Alice Mutinynet: <https://mutinynet.alicebtc.com>
- Android: APK distributed directly through the closed-beta channel

The macOS application is available for local QA but is not distributed yet. It
still requires Apple Developer ID signing and notarization.

## Safety Rules

- Create a new wallet dedicated to the beta.
- Back up its recovery phrase before funding it.
- Never send a recovery phrase, private key, or sensitive screenshot to Alice,
  a tester, or a bug-report form.
- Start with `335` to `2,000` sats per action.
- Keep no more than `25,000` sats in the beta wallet.
- Wait for an operation to reach a clear final state before starting another.
- Stop immediately if the amount, fees, status, or recovery path is ambiguous.

Alice is self-custodial beta software. Do not use funds you cannot afford to
lose.

## Suggested Test

1. Create a new wallet and back up the recovery phrase.
2. Receive a small Arkade or Bitcoin payment.
3. Open the transaction history and transaction details.
4. Send a small payment and verify the final state.
5. Open Alice and ask one basic and one technical Bitcoin question.
6. Open `ALICE MEMORY`, inspect what was retained, forget one item, and confirm
   that the other items remain.
7. Restart the application and check the wallet, history, selected AI mode, and
   retained memory.
8. Submit one real or simulated report from Settings.

## Reporting Problems

Use `Settings > Report` or `Settings > Support & Contribute`.

The report can be copied, sent to `report@alicebtc.com`, or opened as an issue
in the public
[`alice-support-contribute`](https://github.com/mariusoffchain/alice-support-contribute)
repository. Include the platform, version, action, expected result, and actual
result. Never include wallet secrets.

## Known Limits

- Private Cloud is currently `attested-unpinned`. Transport encryption and TDX
  attestation verification are implemented, but Venice has not yet published
  the reference measurements required to pin the exact enclave identity.
- The stored Alice Memory remains on the device. Existing memories are not sent
  to Private Cloud or Custom AI during this beta.
- Semantic RAG is available on Android, Alice Web and Desktop. The
  installable PWA currently uses lexical retrieval over the same knowledge
  base.
- Satora is an external swap service. If it is unavailable, direct Arkade and
  Bitcoin functions may still work, but swaps can fail.
- The Android Lite model is intended for constrained phones and provides lower
  answer quality than larger local models or Private Cloud.

Current service availability is not a release guarantee. External providers
can be temporarily unavailable.
