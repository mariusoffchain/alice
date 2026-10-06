# Dependency audit

Alice uses a lockfile and runs `npm audit` in CI after a clean install. The CI
fails on any critical vulnerability, any high-severity package or advisory not
in the reviewed baseline, and when that baseline expires.

## Current reviewed baseline, 2026-10-05

Review of the 2026-10-04 baseline before its 2026-10-20 expiry. Audit after a
clean install: 25 high / 16 moderate / 2 low / 0 critical, down from 27 high.
The 25 high package entries trace to **2 direct advisories**. Expiration moves
to **2026-11-02**.

### What changed

- **ws under viem is fixed.** The scoped override `viem > ws 8.22.0` was
  already in `package.json`, but the lockfile kept a nested
  `node_modules/viem/node_modules/ws` entry at 8.20.1 and npm never revisits
  a locked node that still satisfies its dependant, so the override had no
  effect. Removing that lock entry and reinstalling makes viem resolve the
  root `ws` 8.22.0 (checked with `require.resolve` from the viem package and
  with a dry `npm ci` validation). The exception, its advisory id (1123259)
  and its reviewed node leave the gate; a regression that brings the nested
  copy back fails the gate instead of inheriting the exception.
- **braces 3.0.3** ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm))
  and **node-forge 1.4.0** ([GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv))
  remain. On this review date the npm registry still publishes 3.0.3 and 1.4.0
  as latest, and both GitHub advisories (last updated 2026-10-02 and
  2026-10-01) list no patched version. Reachability is unchanged from the
  2026-10-04 analysis below: build-host file discovery for braces, Expo
  development certificates for node-forge, neither in the app-web client
  graph (`WebClientBoundaryPlugin`) nor in the Worker.

### Interim update, 2026-10-06

Two advisories published on 2026-10-06 turned the gate red on every branch:
`compression` 1.8.1 (GHSA-vc2v-76pw-4v95, memory leak on a premature response
close) and `source-map-js` 1.2.1 (GHSA-68fv-2mgg-jv7q, event-loop denial of
service through indexed source-map offsets). Both are transitive, single
nodes in the lockfile with no dependant pinning them below the fix, so
`npm update compression source-map-js` moved them to 1.8.2 and 1.2.2 inside
their declared ranges; the lockfile diff is those two entries. Audit after the
update: 25 high / 0 critical, no new package or advisory, baseline and expiry
unchanged.

### Next review, by 2026-11-02

Rerun the audit, check `npm view braces version`, `npm view node-forge
version` and both advisories for a patched version; install it through the
existing scoped overrides if one exists, otherwise re-justify and move the
date. The nested-copy lesson applies to any future override: after adding
one, confirm in the lockfile that the nested node is gone, not only that the
override is written.

## Baseline of 2026-10-04 (previous review)

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
- Metro family → 0.83.8 through 14 scoped overrides (merge of 2026-10-05).
  Metro 0.83.8 ships its own image parser, so image-size leaves the dependency
  graph entirely instead of being overridden to 2.0.4: the earlier
  `metro > image-size 2.0.4` override broke `getAssetData` on Metro 0.83.3,
  which passes a file path that image-size 2.x rejects (recorded in
  `scripts/data/dependency-image-size-rejected-2026-10-04.json`). The 0.83.8
  migration was checked on the project's 36 assets with
  `scripts/check-metro-assets-compatibility.cjs`
  (`scripts/data/dependency-metro-2026-10-04.json`).
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

## Remediation sections carried from the RAG branch (2026-10-04)

Reconciled on 2026-10-05 when `ai/rag-query-rewrite` merged into `main`. Of
the remediations below, the Metro 0.83.8 migration is what `main` keeps; for
Miniflare's Undici `main` retained 7.30.0 rather than 7.29.1, and the adm-zip
override uses the unqualified `onnxruntime-node` key. The audit counts quoted
in these sections (for example "30 high") describe the branch at the time, not
the merged tree; the gate itself is the one described in the current baseline
above (`REVIEWED_HIGH_NODES`, three direct advisories, review by 2026-10-20).

## Metro image-parser migration on 2026-10-04

Fourteen coordinated Metro overrides move the installed family from 0.83.3 to
0.83.8, within the same minor branch. Expo 54.0.35, @expo/metro 54.2.0 and
React Native 0.81.5 remain unchanged. Expo still pins the old Metro family, so
updating only a direct package would leave old copies installed. The
[official patch release](https://github.com/react/metro/releases/tag/v0.83.8)
replaces image-size with an in-tree image-dimensions parser; the
[upstream change](https://github.com/react/metro/pull/1860) also reuses the asset
buffer already read for hashing. This fixes the earlier path-call failure
without a local shim or direct image-size2 override.

The resolved graph changes 1154 → 1155 entries. The removed image-size/queue
code is replaced by Metro's installed parser, and metro-source-map drops an
unused Babel traverse alias. Four new records belong to content-type and the
new accepts/mime-types/negotiator requirements. Metro's ob1 and nested Hermes
parser/ESTree dependencies update alongside it. Other same-version metadata
changes are retained from npm resolution. No inference, attestation or wallet
package changes. The incidental yaml2.9.1 update is excluded by restoring its
complete 2.9.0 lock record, still within Metro's unchanged ^2.6.1 range.

Resolve the 14 named Metro packages with npm 11.21.0, `npm update <names>
--package-lock-only --ignore-scripts --no-audit --no-fund`, using the checked-in
overrides, then preserve unrelated lock entries as described above. Clean
`npm ci --ignore-scripts --no-audit --no-fund` succeeds with npm11.16.0 / Node
24.18.0, installing 1025 packages on this Mac. Inspect the family and preserved
versions using the complete evidence in `dependency-metro-2026-10-04.json`.
No main-checkout dependencies or global tools are changed.

Verification:

- 1261/1261 tests in 154 files and workspace types pass on the isolated install.
- Actual before/after asset APIs agree on all 36 tracked supported project
  images, including dimensions, hashes and complete metadata. Three valid PNG
  fixture groups cover generic/Android/iOS and @2x selection, plugin output,
  and returned file bytes. Mismatched extensions and relative SVG viewBox
  checks pass. Thirty-six candidate-only malformed-input checks reject in a
  bounded child process; this is not an exhaustive image security audit.
- Paired production Android exports succeed with Hermes, including an extra
  candidate export after clearing Metro's cache. The 55-file lists and 34
  asset-map entries match; metadata matches after normalizing checkout paths,
  and all non-bundle assets are byte-identical. The 16819566-byte Hermes
  bundles have different raw hashes, including repeated candidate builds, so
  binary identity is not claimed. Exact hashes are recorded.
- Paired Web exports use separate fresh cache directories; every output file
  is byte-identical. These exports do not prove browser behavior, APK/native
  execution, device performance or generated-answer quality.

```sh
node scripts/check-metro-assets-compatibility.cjs /path/to/old-installed /path/to/new-installed <tmp>/new-metro-assets.json
# From apps/wallet-mobile, with a new output path for each run:
EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 CI=1 node ../../node_modules/expo/bin/cli export --platform android --output-dir <tmp>/new-android-export --max-workers 2 --dump-assetmap --clear
# Use --platform web for the separate Web export.
```

Fresh audit falls to **30 high, 17 moderate, 2 low, zero critical**. Only
image-size disappears; no finding is added. Remove its obsolete package
exception, add none, preserve the 2026-10-20 expiry. Fourteen policy checks
pass; the actual gate still exits 1 on braces/node-forge advisories and their
transitive chains. No release-ready claim. Prior Undici-head CI 37231539993
passes clean install/full tests/types, then fails its existing audit.

## Miniflare transport remediation on 2026-10-04

A scoped `miniflare > undici: 7.29.1` override updates the two copies previously
pinned to 7.28.0 and 7.29.0. Miniflare 4.20260730.0 and 5.20260921.0-alpha stay
unchanged, as do all other packages including root Undici 6.28.1. Exactly two
lock records change; all 1154 entries remain. Node 24.18.0 satisfies the new
package's >=20.18.1 engine. The [official release](https://github.com/nodejs/undici/releases/tag/v7.29.1)
fixes, among others, dropped TLS validation callbacks and unsolicited WebSocket
subprotocol crashes. This does not mean Alice exercised those exploit paths.

Resolve with npm 11.21.0 as above, targeting `undici` instead of `adm-zip`.
That general update also proposed 6.28.1 → 6.29.0 for the unrelated root copy;
restore that complete lock record from the base to preserve this lot's scope,
then assert exactly two records changed before `npm ci --ignore-scripts
--no-audit --no-fund`. Clean installation under npm 11.16.0 installs 1024 Mac
packages and both Miniflare parents actually resolve 7.29.1. No global npm or
shared main-checkout dependency changes.

All 1261 tests across 154 files and workspace types pass in the isolated
installation. Existing D1 tests exercise small RPC payloads; direct Worker
fetch mocks do not establish transport compatibility. The new verifier runs
unchanged Miniflare 4 and 5 before/after, each in its own bounded process,
against caller-owned local workerd runtimes. All four runs preserve a streamed
524384-byte body in order, POST body/status/headers, cancellation followed by
a successful request, and a Miniflare/ws WebSocket upgrade/echo. Request/Response
subclass metadata, clone, error, redirect, upgrade and disposal also pass.
This is not an Undici WebSocket-client exploit test, external-provider test or
cloud E2EE validation.

```sh
node scripts/check-miniflare-undici-compatibility.cjs /path/to/before-installed /path/to/after-installed <tmp>/new-miniflare-report.json
```

Fresh audit reports **31 high, 17 moderate, 2 low, zero critical**. Undici and
its Wrangler finding disappear; no finding is added. Remove only Undici and
its old high advisory ID 1130718 from accepted sets. Eleven policy checks pass,
and the actual gate still exits 1 on remaining findings. Expiry stays
2026-10-20; this is not a new accepted baseline. Full evidence/reproduction is
`scripts/data/dependency-undici-2026-10-04.json`.

The audit was initially denied by automatic approval review over dependency
inventory disclosure. Offline inspection of npm's actual `prepareBulkData`
confirmed 861 dependency names/version lists and no Alice workspace names,
source, repository URL, prompts, answers or secrets in the request body. A
review with those new facts and explicit registry.npmjs.org destination allowed
the normal audit and real gate; no alternative transport or bypass was used.

A separate direct image-size 1.2.1 → 2.0.4 trial is rejected. Unmodified Metro
0.83.3 still succeeds with `getAssetSize(Buffer)` but `getAssetData(path)` throws
because the new parser no longer accepts a path through that API. Both old
calls succeed on the same existing PNG. The image-size manifest/lock remain
unchanged; a compatible Metro migration is still needed. Exact probe and
registry/source evidence are in `dependency-image-size-rejected-2026-10-04.json`.

## ONNX installer ZIP remediation on 2026-10-04

A root override limited to `onnxruntime-node@1.24.3 > adm-zip` pins `0.6.1`.
The [upstream advisory](https://github.com/advisories/GHSA-7q85-xj36-vmfc)
and [release notes](https://github.com/cthackers/adm-zip/releases/tag/v0.6.1)
identify the patched release. The registry integrity matches the new lock
entry. This crosses the parent's `^0.5.16` range deliberately, after testing
the actual unchanged installation helper. No parent version changes.

npm 11.16.0 silently retains 0.5.18 with both qualified and unqualified scoped
overrides, even after update and clean installation. npm 11.21.0 resolves the
same intended override correctly: only one lock record changes and all 1154
lock entries remain. This matches the documented
[workspace/file-link override defect and fix](https://github.com/npm/cli/pull/9671).
Do not infer the earlier dropped-package incident had the same exact cause;
that incident was rejected, while this trial explicitly preserves the graph.
No global npm installation is changed.

To regenerate this targeted resolution, use Node 24.18.0 and:

```sh
npm exec --yes --package=npm@11.21.0 -- npm update adm-zip --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
```

The second command also succeeds under the existing npm 11.16.0, installing
1024 packages for this Mac, including actual adm-zip 0.6.1. Transformers,
onnxruntime-node/common, sharp and dcap-qvl retain their previous versions.
The default ONNX postinstall succeeds on macOS arm64 with bundled binaries;
that early-exit path is not a real NuGet/GPU download proof.

`check-adm-zip-compatibility.cjs` invokes the actual ONNX `installPackages`
helper for both installed versions against a mocked in-memory NuGet feed.
It checks nested file extraction with flattened basenames, distinct files
sharing a basename, empty files, final copied bytes and missing-entry failure.
Candidate-only bounded fixtures verify duplicate-name rejection, refusal to
write through a destination symlink, and allocation independent of an inflated
STORED entry size. Seven scenarios pass, without live network, shell execution
or executing any archive content. The 0.6.0 directory-entry extraction change
is outside the helper's file-entry path. This is not an exhaustive archive
security audit or an actual Windows/GPU installation test.

```sh
node scripts/check-adm-zip-compatibility.cjs /path/to/old-installed-checkout /path/to/fixed-installed-checkout <tmp>/new-admzip-report.json
```

Fresh audit removes adm-zip and its affected onnxruntime-node chain: 32 high,
18 moderate, 2 low and zero critical remain, no newly reported package.
Their obsolete accepted package entries and advisory IDs 1123686/1239030 are
removed from the gate. No exception is added and the 2026-10-20 expiry stays
unchanged. The gate still fails on the remaining advisories. Clean workspace
types and all 1252 tests in 154 files pass (zero failed/skipped). Nine focused
audit-policy checks confirm resolved regressions, critical findings and expiry
remain blocking while retained baseline logic still behaves as expected.
Detailed hashes and before/after audits are in
`scripts/data/dependency-admzip-2026-10-04.json`.

## Targeted lockfile remediation on 2026-10-04

Seven existing `brace-expansion` installations were stale within their parent
caret ranges. `npm update brace-expansion --package-lock-only --ignore-scripts
--no-audit --no-fund` updates only those seven records: 1.1.15 -> 1.1.21,
2.1.1 -> 2.1.7 and 5.0.6 -> 5.0.12. No manifest, override, exception, expiry or
audit-script change is included. Registry versions and all seven installations
in a clean isolated `npm ci --ignore-scripts` were verified; shared development
node_modules were not modified.

The fresh audit no longer reports `brace-expansion`: 35 high, 18 moderate,
2 low, zero critical remain. This is one fewer high package, not ten fewer
packages just because several advisories disappeared. Workspace types pass on
the clean install; all 1197 tests pass across 148 files (zero failed/skipped). The unchanged audit gate still fails with exit 1 on
the remaining new packages/advisories; no finding is suppressed. `scripts/data/dependency-remediation-2026-10-04.json` records
paths, hashes, remaining high packages and verification state.

The subsequent targeted follow-up updates only `node_modules/shell-quote`
from 1.8.4 to 1.12.0, still inside its parent's ^1.6.1 range. The
[official advisory](https://github.com/advisories/GHSA-395f-4hp3-45gv) identifies
1.9.0 as patched; registry and installed 1.12.0 were verified. Clean install,
workspace types and 20 argument-quoting/parsing compatibility checks pass.
The standalone verifier handles only strings, never shell execution, and
parses 16,000 tokens in about 5 ms on this Mac (an observation, not an
exhaustive complexity proof). Glob tokens retain the old library behavior;
an initial assumption that every quoted argument round-trips as a string was
incorrect for both versions and was replaced by an explicit compatibility check.

Reproduce with `node scripts/check-shell-quote-compatibility.cjs
<old-package-dir> <new-package-dir> [report.json]`. The fresh audit no longer
reports shell-quote and has 34 high, 18 moderate, 2 low and zero critical.
The unchanged gate still fails. The 1,197-test full-suite pass above predates
this one-package follow-up; its matching-head CI remains to be checked.

`undici` is pinned exactly by both Miniflare instances, while `image-size` and
`adm-zip` have parent ranges excluding their published fixed major/minor lines.
These require compatibility work, not a claim that only upstream action is
possible. All remaining blockers stay visible.

## Unresolved gate observed on 2026-10-04

CI run 37203999140 at `68ec6395` passed all 1,174 tests and workspace types,
then failed the unchanged audit policy with 36 high and 0 critical findings.
A fresh local `npm audit --json` reproduced those counts. This is not a new
accepted baseline; the exceptions, expiry and dependencies have not changed.

New high chains include Expo code signing (`node-forge`) and Metro/Jest glob
handling (`braces` through `micromatch`). The reviewed advisory pages currently
list no patched version for [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
or [node-forge GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
Other new reports affect `adm-zip`, `brace-expansion`, `image-size` and `undici`.
Their dependency paths and compatible replacement versions still need a
separate remediation/validation pass. No force downgrade, exception expansion
or claim of release readiness was made during the RAG context-budget lot.

## Historical baseline, 2026-09-22

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


### Reviewed on 2026-10-06

Updated only 2 lockfile resolutions within their existing parent ranges. No new override or audit exception was added, and the existing 2026-10-20 baseline deadline is unchanged.

- `compression` 1.8.1 → 1.8.2, used by `@expo/cli` (`^1.7.4`). Fixes the premature-response-close memory leak, [GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95).
- `source-map-js` 1.2.1 → 1.2.2, used by PostCSS and `@tailwindcss/node` (`^1.2.1`). Fixes event-loop blocking from indexed source-map offsets, [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Reproduce with Node 24 and `npm update compression source-map-js --package-lock-only --ignore-scripts`, then `npm ci` and the CI checks. The lockfile resolution was generated in a temporary workspace copy to avoid modifying shared local node_modules. Only these 2 package entries changed. A registry audit and the unchanged audit gate passed on the corrected lockfile: neither package is reported; 27 high and 0 critical findings remain in the previously reviewed baseline. This is not a clean-vulnerability claim. Fresh installation, tests and type validation run in the private PR CI; application previews rebuild from the corrected commit.
