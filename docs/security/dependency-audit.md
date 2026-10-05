# Dependency audit

Alice uses a lockfile and runs `npm audit` in CI after a clean install. The CI
fails on any critical vulnerability, any high-severity package or advisory not
in the reviewed baseline, and when that baseline expires.

## Current reviewed baseline — 2026-10-04

The web release maintenance pass reduces the audit from 36 high / 18 moderate /
2 low to 27 high / 16 moderate / 2 low, with 0 critical. The 27 high package
entries trace to **3 direct advisories**, not 27 independent bugs. They remain
visible in `npm audit`; the gate accepts only the reviewed advisories, package
names, exact direct-node locations and versions below. All removed advisory
exceptions are removed from the gate. Expiration stays **2026-10-20**.

### Corrections installed and locked

- `brace-expansion` → 1.1.21, 2.1.7 and 5.0.12 on their existing major lines;
  `nanoid` → 3.3.19; `shell-quote` → 1.12.0.
- PostCSS → 8.5.28, including Next's otherwise-pinned older copy.
- Miniflare's Undici → 7.30.0 and the Expo CLI's → 6.29.0.
- Sharp → 0.35.5 (libvips 1.3.4), adm-zip → 0.6.1. Scoped overrides are
  checked with a clean install; these packages remain installed, rather than
  disappearing from the lockfile as happened in the September attempt.
- Metro's image-size → 2.0.4. Metro uses the synchronous default export on a
  Buffer, which 2.0.4 retains. Its actual `getAssetSize` was exercised with PNG
  data. Alice does not use the removed filename/callback interface.
- Compatible ws branches move to 6.2.6, 7.5.13 and 8.22.0. The viem peer tree
  still resolves its own pinned 8.20.1 despite the attempted scoped override;
  it is NOT claimed fixed and retains the previously reviewed exception.

No framework major, wallet SDK downgrade or cryptographic downgrade is used.
In particular `@phala/dcap-qvl` remains 0.6.1, above the security floor required
by Alice's attestation checks. Its low elliptic signing advisory remains
accepted for the verification-only use described below.

### Remaining high findings and reachability

1. **braces 3.0.3**, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
   stack exhaustion from deeply nested glob patterns. npm and GitHub report no
   patched release on this review date. The chain is micromatch → Metro/Jest
   file discovery; inputs are repository filenames/configuration on the build
   host. Application code does not import it. Do not run these tools on
   untrusted project configurations or globs.
2. **node-forge 1.4.0**, [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
   RSA verification with low-exponent keys and malformed DigestAlgorithm ASN.1.
   npm and GitHub report no patched release. Installed through Expo CLI and
   `@expo/code-signing-certificates`, whose code handles development certificate
   generation and verification. This web delivery uses Next static export,
   not Expo OTA signing, and the Worker uses neither package. This is NOT a
   blanket approval for mobile signing or verifying untrusted certificates.
3. **ws 8.20.1 under viem**, GHSA-96hv-2xvq-fx4p, the previous Node-only
   WebSocket decompression/memory exception. The browser transport uses the
   browser WebSocket; no Node server from this package is shipped by the static
   app. npm suggests downgrading Satora; that is rejected. Revisit the pinned
   viem peer tree separately rather than migrate wallet SDKs during this UI
   release.

`WebClientBoundaryPlugin` now makes every app-web client build fail if `braces`
or `node-forge` enters the client module graph (including nested modules).
The build must print its boundary check success; the exception cannot silently
turn into shipped client code. The Worker has no dependency path to either.
The other high package entries (including Expo/React Native and Arkade/Satora
via optional Expo peers) propagate these same underlying advisories.

Remaining moderate findings are `decode-uri-component` through mobile routing
and `uuid` through Expo/Xcode build tooling. This pass does not change the
existing gate's high/critical policy or claim a zero-vulnerability repository.
The next native/mobile release needs its own scope-specific review.

### Miniflare diagnosis

The original account-test failure was an incomplete shared `node_modules`
installation in the local worktree, not a test API regression: the lockfile
already pins Miniflare 4 for the Worker and Miniflare 5 under Wrangler. A clean
`npm ci --ignore-scripts` restores both; the 36 account tests pass unchanged.
The same original commit also passed all tests and types in GitHub Actions;
its only CI failure was the audit gate. Do not link only another checkout's
root `node_modules`: workspace-local dependencies are required as well.

## Historical baseline — 2026-09-22

The release check on 2026-09-22 reports 22 high findings and 0 critical. Every
high finding is transitive. The baseline began with the full review on
2026-08-09 and was rechecked as advisories and locked versions changed. The
remaining findings fall into two groups:

- **Build and test tooling only**, the Expo/Metro/React Native CLI chain
  (`metro`, `@expo/cli`, `image-size`, `js-yaml` via `@expo/xcpretty` and
  `babel-jest`), plus
  Next/PostCSS/Tailwind build dependencies. This code runs on a developer or
  CI machine against Alice's own files; it never ships in a client bundle and
  parses no attacker-controlled input.
- **Runtime-reachable but not exploitable in our usage**, `nanoid`
  (advisory concerns custom generators; Alice's dependency chain only calls
  the standard generator), and the previously reviewed inference/payment
  chains (Hugging Face Transformers, ONNX Runtime, Arkade/Satora).

### Reviewed on 2026-08-16

Three further high-severity advisories were published against packages already
in the baseline. No newly added dependency introduced them: the explorer's new
packages (`@arkade-os/sdk`, `@bitcoinerlab/descriptors`, `@scure/btc-signer`)
pull none of the three.

- `fast-uri` GHSA host confusion via failed IDN canonicalization (advisory
  1144861). It was on the `ajv` chain inside `expo-build-properties` and
  `expo-dev-launcher`, prebuild and dev-client only. Version 3.1.5 later closed
  the full family before release.
- `nanoid` zero-size generator loop (advisory 1139427). This one **does ship**,
  via `expo-router`. The loop requires generating an id of size zero; neither
  Alice nor `expo-router` requests a custom size, and no user input or network
  response reaches that argument, so an attacker has no way to trigger it.
- `postcss` path traversal in sourceMappingURL auto-loading (advisory 1139510).
  Same family as the accepted 1124252 and 1130709. PostCSS runs during
  `next build` and Metro bundling, over Alice's own stylesheets; reaching it
  requires write access to the repository, which is a prior compromise.

### Reviewed on 2026-08-19

One further advisory, and a full reachability pass over all 41 findings while
the accounts branch was merged.

- `fast-uri` host confusion via failed IDN canonicalization (advisory
  1145454). The third of the family, on the same prebuild-only `ajv` chain. An
  initial override attempt failed to re-resolve the lockfile cleanly and was
  reverted. The lockfile was later regenerated with 3.1.5 before release.

- **`@phala/dcap-qvl` must never be "fixed".** `npm audit` proposes downgrading
  it from 0.6.1 to 0.2.0 to clear the `elliptic` advisory. That downgrade would
  reintroduce CVE-2026-22696, which
  `packages/alice-ai/src/venice-attestation-verify.ts` explicitly requires
  >= 0.3.9 to avoid, in exchange for an advisory that does not apply: the
  elliptic flaw truncates the nonce during ECDSA **signing**, and dcap-qvl only
  ever calls `keyFromPublic` and `verify`. Alice signs nothing with it. Running
  `npm audit fix --force` here would weaken the attestation path that the whole
  end-to-end encryption claim rests on.

- Nothing else reaches a user. Both Next apps are `output: 'export'`, so no
  server runs in production and `postcss`, `nanoid` and `sharp` stay build-time.
  The Node-only paths of `@huggingface/transformers` (`onnxruntime-node`,
  `sharp`, `adm-zip`) and the `ws` pulled by `viem` are installed but never
  bundled: no `libvips`, `onnxruntime-node` or `PerMessageDeflate` in the 3.4 MB
  web bundle or the 8.5 MB mobile one. `undici` exists only under `miniflare`,
  inside `wrangler`.

  This is a reachability finding about the current bundles, not a permanent
  property. An import that pulls a Node path into a client changes it.

### Reviewed on 2026-08-21

- `fast-uri` 3.1.5 is now locked through the root override and closes all 4
  advisories in that family, including 1145555 (GHSA-4c8g-83qw-93j6).
  `npm audit` no longer reports `fast-uri`. Its package and advisory ids were
  removed from the accepted baseline, so any dependency regression that
  reintroduces a high finding fails the gate instead of inheriting the old
  exception.

### Reviewed on 2026-09-22

The baseline had expired on 2026-09-19, and the gate reported one critical and
seven high findings outside it. Everything that could be upgraded inside its
declared range was; what could not is reviewed below and accepted. The gate is
green again with 22 high findings, every one on a chain reviewed before.

- `next` 15.5.22 to 15.5.25. Two critical advisories, unauthenticated remote
  code execution on Windows-hosted servers (GHSA-p293-qw3h-jr36) and in the
  image optimisation API (GHSA-2xp9-vwfh-vxw4). Neither reaches Alice: both
  Next apps are `output: 'export'`, no Next server runs anywhere, and no
  image optimisation endpoint exists. Upgraded anyway, since the gate refuses
  any critical and a patch release costs nothing. Both apps build and export.
- `wrangler` 4.114.0 to 4.136.2 for the Worker's tooling, which carried the
  `miniflare`/`sharp`/`undici` findings. Wrangler now ships Miniflare 5, an
  alpha whose constructor takes a different shape, so the Worker's own tests
  keep `miniflare` 4.20260730.0 as an explicit dev dependency. Tests only;
  nothing of it is deployed.
- `@xmldom/xmldom` 0.8.13 to 0.8.15 and 0.9.10 to 0.9.12, nineteen advisories
  in one release wave. Reached only through `@expo/plist` and `plist` inside
  the Expo prebuild chain, which parses Alice's own Xcode project files on a
  developer machine.
- `fast-uri` 3.1.5 to 3.1.8, four new advisories. The earlier root override
  is gone and `ajv`'s own range now resolves the fixed release. Same
  `expo-build-properties` prebuild-only chain as reviewed on 2026-08-16.
- `browserslist` 4.28.2 to 4.29.0, `js-yaml` 4.2.0 to 4.3.2 and 3.14.2 to
  3.15.2. Babel and Expo build tooling, run against Alice's own files.
- `adm-zip` (GHSA-7q85-xj36-vmfc, uncontrolled allocation from a declared
  size) and `sharp` (GHSA-rgj7-g3m4-5g8c, libheif) gained one advisory each.
  The fixes are 0.6.1 and 0.35.4, outside the ranges `onnxruntime-node` and
  `@huggingface/transformers` declare. A root override was tried and
  rejected: with it, npm silently dropped both packages from the tree
  instead of upgrading them, which would have turned the gate green by
  removing the code rather than fixing it. Accepted instead, on the ground
  the review of 2026-08-19 established and this one rechecked: both sit on
  the Node-only inference path, installed but never bundled, and Alice parses
  no archive and no image through them.
- `miniflare` 4.20260730.0 stays flagged through its pinned `sharp` 0.35.2
  and `undici` 7.28.0. It exists only to run the Worker's tests on a
  developer machine and is deployed nowhere; the Worker itself ships through
  Wrangler with no Miniflare inside.

Packages and advisory ids that these upgrades removed from the audit output
(`@react-native/community-cli-plugin`, `js-yaml`, `next`, `react-native`, and
their advisories) were dropped from the accepted baseline, as on 2026-08-21,
so a regression fails the gate. `miniflare` was added, for the reason above.

The baseline expires on 2026-10-20. It is not a waiver: before that date each
chain must be upgraded, replaced, or explicitly reviewed with evidence that a
breaking migration would create more risk than it removes.

No `npm audit fix --force` is applied automatically. Its current proposals
include a major Next upgrade and a Satora downgrade, neither of which is safe
during the private beta.
