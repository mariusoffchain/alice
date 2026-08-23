# Alice Closed Beta

Alice is currently in a closed mainnet beta. This build is intended for known
testers using a fresh wallet and small amounts only.

## Tested Release

Alice's source lives at <https://github.com/mariusoffchain/alice>.

- Version: `0.2.0`
- Source: public tag `v0.2.0` in <https://github.com/mariusoffchain/alice>.
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
shasum -a 256 -c SHA256SUMS-v0.2.0.txt
```

**Was it signed by Alice?** This is the one that matters when an APK reaches
you through someone else. Alice releases are signed with one key, and its
certificate fingerprint is published here. A build signed by anyone else
carries a different fingerprint, whatever its file name says:

```
SHA-256  1f52d235f5d404242cf974819338e168406867c2fbc448f20623bf776cad744b
```

```bash
apksigner verify --print-certs Alice-Wallet-beta-0.2.0-v8.apk
```

The key changed once, between 0.1.0 and 0.2.0, together with the Android
application id (see "Updating Alice Wallet from 0.1.0" below). The 0.1.0 APK
was signed with `189bf5a7bb13f8ddde59074bcdba4b8799368c8cf50b249e1c9d7b4455eef26c`;
that fingerprint is only valid for that release. From 0.2.0 on, the key above
is the one to expect.

Android enforces this on its own: it refuses to install an update signed with
a different key than the app already on the device. The manual check is for
the first install, which is exactly when you have nothing to compare against.

### How this build was produced

| | |
| --- | --- |
| Tag | `v0.2.0` |
| Commit | the commit the `v0.2.0` tag points to, listed in the GitHub Release |
| Android application id | `com.alicebtc.wallet` |
| Android version code | `8` |
| Expo SDK | `54.0.35` |
| React Native | `0.81.5` |
| Node | `24` |
| Build service | Expo Application Services (EAS), `beta` profile, local build (`--local`) signed with the EAS-held keystore |
| Native AI engine | llama.rn compiled from its bundled sources during the build (`rnllamaBuildFromSource=true`); its prebuilt download is skipped with `RNLLAMA_SKIP_POSTINSTALL=1` and `scripts/eas-post-install.js` |

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

Desktop installers are attached to the `0.2.0` GitHub Release. The first beta
can be distributed before trusted Apple and Windows certificates are available.

## Updating Alice Wallet from 0.1.0

0.2.0 ships under a new Android application id (`com.alicebtc.wallet`), so
it installs as a separate app next to 0.1.0 rather than over it. Back up
your recovery phrase from 0.1.0 first, install 0.2.0, import the phrase,
check your balance, then uninstall 0.1.0.

## Installing Alice Desktop 0.2.0

The GitHub Release contains a universal macOS DMG, a Windows MSI, a Linux
AppImage and a Debian package. It also contains one build information file per
platform. Read its `signing` line before installing. Early beta builds can be
published without a trusted certificate. This is expected to produce the
warnings described below, but it does not replace checksum verification.

Compare the downloaded installer with `SHA256SUMS-desktop-v0.2.0.txt` from the
same release before opening it.

### macOS

Open the DMG and drag Alice into Applications. A build without an Apple
Developer ID uses an ad hoc signature for Apple Silicon compatibility, so
macOS can say that the developer cannot be verified. In Applications,
right-click Alice, choose **Open**, then confirm **Open**. This explicit action
only bypasses the warning for this application.

When the `APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` secrets are
available, the release workflow signs the application with that identity. If
`APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` are also available, it
notarizes the DMG. A certificate without notarization can still produce a
Gatekeeper warning.

### Windows

Open the MSI. An unsigned build can trigger Microsoft Defender SmartScreen and
show **Windows protected your PC**. Choose **More info**, verify that the file
name and checksum match the release, then choose **Run anyway**. A signed
certificate can still show SmartScreen until it has acquired enough reputation.

When `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` contain a
base64-encoded PFX and its password, the release workflow imports it and signs
the MSI automatically. With neither secret, the MSI remains unsigned. A single
missing secret stops the job rather than silently publishing an unsigned file.

### Linux

Linux shows no comparable platform signature warning for these files. For the
AppImage, make it executable and run it:

```bash
chmod +x Alice_0.2.0_*.AppImage
./Alice_0.2.0_*.AppImage
```

On Debian or Ubuntu, install the local package with:

```bash
sudo apt install ./Alice_0.2.0_*.deb
```

## Publishing the Android 0.2.0 APK

This operation requires the maintainer's Expo account. Run every EAS command
from `apps/wallet-mobile`, not from the repository root. The root contains a
different `eas.json` without Alice Wallet's mainnet environment or APK format.

The mobile configuration declares app version `0.2.0`. The distributed APK
uses the `beta` profile: it inherits the `production` environment
(`EXPO_PUBLIC_NETWORK=bitcoin`, remote credentials, auto-incremented remote
version code) and marks the build as internal distribution, which is what a
GitHub Release installation is.

1. Authenticate with the `alicebitcoin` Expo account, enter the mobile
   workspace, inspect the currently stored version code, then start the build:

   ```bash
   cd apps/wallet-mobile
   npx eas-cli@latest login
   npx eas-cli@latest build:version:get --platform android --profile beta
   npx eas-cli@latest build --platform android --profile beta
   ```

2. Wait for the build to finish. Copy its build ID and record the exact
   `versionCode` displayed on the EAS build page. Download that build only:

   ```bash
   export EAS_BUILD_ID="paste-build-id-here"
   npx eas-cli@latest build:download --build-id "$EAS_BUILD_ID"
   ```

3. EAS does not guarantee Alice's public release filename. The suffix is the
   `versionCode` Android actually reads from the file, never a number chosen
   to fit an existing URL. Read it from the APK itself:

   ```bash
   aapt dump badging path/to/downloaded.apk | head -1
   ```

   The 0.2.0 build carries version code `8`. Rename the file with that code,
   and make sure `ANDROID_APK_URL` in `apps/site/src/lib/site.ts` ends in the
   same `v8.apk`; if the two disagree, fix the URL, not the file name:

   ```bash
   mv path/to/downloaded.apk Alice-Wallet-beta-0.2.0-v8.apk
   ```

4. Calculate and verify its SHA-256 digest:

   ```bash
   shasum -a 256 Alice-Wallet-beta-0.2.0-v8.apk \
     > SHA256SUMS-v0.2.0.txt
   shasum -a 256 -c SHA256SUMS-v0.2.0.txt
   ```

5. Upload the APK and checksum to the draft release, then inspect both assets
   in the GitHub interface before publishing:

   ```bash
   gh release upload v0.2.0 \
     Alice-Wallet-beta-0.2.0-v8.apk \
     SHA256SUMS-v0.2.0.txt \
     --clobber
   ```

6. In `apps/site/src/lib/site.ts`, change only `ANDROID_VERSION` from `0.1.0`
   to `0.2.0` after the release assets exist. This derives the release page and
   APK download URLs. Confirm both URLs return the intended files before the
   site is deployed.

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
