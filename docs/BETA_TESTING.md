# Alice Closed Beta

Alice is currently in a closed mainnet beta. This build is intended for known
testers using a fresh wallet and small amounts only.

## Tested Release

Alice's source lives at <https://github.com/mariusoffchain/alice>.

- Version: `0.1.0`
- Source: public tag `v0.1.0` in <https://github.com/mariusoffchain/alice>.
- Android: the official APK, its version code and its SHA-256 are published
  together in the GitHub Release attached to that tag.

The earlier `0.0.1` APK predated the public source snapshot and was not
reproducible from its tag. Do not distribute it as the closed-beta release.
Starting with `0.1.0`, the APK is built from the validated public tree and its
checksum is published with the binary.

### Verifying the APK you were given

Two checks, and they answer different questions.

**Is this the file Alice published?** Compare its checksum with the
`SHA256SUMS` file from the same release:

```bash
shasum -a 256 -c SHA256SUMS-v0.1.0.txt
```

**Was it signed by Alice?** This is the one that matters when an APK reaches
you through someone else. Every Alice release is signed with the same key, so
the certificate fingerprint below never changes. A build signed by anyone else
carries a different fingerprint, whatever its file name says:

```
SHA-256  189bf5a7bb13f8ddde59074bcdba4b8799368c8cf50b249e1c9d7b4455eef26c
```

```bash
apksigner verify --print-certs Alice-Wallet-beta-0.1.0-v11.apk
```

Android enforces this on its own: it refuses to install an update signed with
a different key than the app already on the device. The manual check is for
the first install, which is exactly when you have nothing to compare against.

### How this build was produced

| | |
| --- | --- |
| Tag | `v0.1.0` |
| Commit | `2982c32c4eb300d93912c3deab8f9479c3ee594c` |
| Android version code | `11` |
| Expo SDK | `54.0.35` |
| React Native | `0.81.5` |
| Node | `24` |
| Build service | Expo Application Services (EAS), `production` profile |

Stated plainly: this describes the build, it does not let you reproduce it.
An EAS build is not byte-for-byte reproducible, so the checksum proves the
file is intact, not that it was compiled from this source. Reproducible
builds are on the roadmap; until they land, the fingerprint above is what ties
a binary to Alice.

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
- Semantic RAG is currently validated on Android. Alice Web, the installable
  PWA and Desktop use lexical retrieval over the same knowledge base during
  this beta.
- Satora is an external swap service. If it is unavailable, direct Arkade and
  Bitcoin functions may still work, but swaps can fail.
- The Android Lite model is intended for constrained phones and provides lower
  answer quality than larger local models or Private Cloud.

Current service availability is not a release guarantee. External providers
can be temporarily unavailable.
