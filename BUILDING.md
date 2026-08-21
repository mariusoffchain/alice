# Building Alice

This document describes a reproducible local build from a clean checkout. It
does not grant access to production services, signing keys, or deployment
credentials.

## Requirements

- Node.js `>=22.12.0 <25` (Node `24` LTS recommended)
- npm compatible with the committed `package-lock.json`
- Android Studio and an Android SDK for native Android builds
- Rust and the Tauri platform requirements for Desktop builds
- Network access for the first build of each surface (see Build-time
  downloads below)

## Clean install and checks

From the repository root:

```bash
npm ci
npm test
npm run check:types
npm run check:release-version
npm run check:npm-audit
```

CI runs the test, typecheck and audit gates; `npm test` also runs the
release-version check before the test files. The explicit version command
above is useful when bumping a release because it fails quickly and names
every stale declaration.
`package-lock.json` is the
dependency source of truth. Do not replace `npm ci` with an unconstrained
dependency update while reproducing a release.

## Build-time downloads

Two asset families are too large for Git and are fetched at build time, each
pinned so the same commit always produces the same build:

- **Embedded Learn packs (English and French, ~29 MB).** Any app-web build
  runs `scripts/prepare-learn-packs.mjs` first (the workspace `prebuild`),
  which downloads them from the published packs tag and refuses to continue
  if that tag was generated from a different corpus commit than the bundled
  catalog. Idempotent: nothing happens when the packs are already present.
  `LEARN_PACKS_SKIP=1` skips it for an offline build, which knowingly ships
  an empty Learn section.
- **Semantic search model and ONNX runtime (~164 MB, desktop only).** The
  desktop build bundles them (`scripts/prepare-semantic-model.mjs`, model
  pinned to one Hugging Face revision, runtime copied from the lockfile-pinned
  `node_modules`), so the installed app resolves `/semantic-model/` on its own
  origin and asks no third party. Web builds fetch the model from the hub on
  first use instead.

Both scripts cache their downloads (`node_modules/.cache/`, `scripts/data/`),
so only the first build of a clean checkout pays them. The pins live in the
two scripts named above; `scripts/publish-learn-packs.mjs` prints where to
advance the Learn pin when a new packs tag is published.

## Local configuration

Copy `.env.example` for local development. The sample files contain no usable
secret. Distributed builds use Alice's Private Cloud proxy and must never embed
the Venice production API key.

The Worker keeps its secrets outside Git through Wrangler secrets. Do not copy
production `.env` files, `.dev.vars`, signing credentials, D1 exports, or test
account data into an issue, pull request, or release artifact.

## Surface builds

Alice App, web (the deploy path sets the same variable via
`apps/app-web/vercel.json`; without it the export would look for downloadable
Learn languages on its own origin, where they do not exist):

```bash
NEXT_PUBLIC_LEARN_PACKS_BASE=$(node scripts/prepare-learn-packs.mjs --print-base) npm run build --workspace @alice-wallet/app-web
```

Alice App, desktop, must run through the workspace so
`apps/app-desktop/build-web.sh` resolves; that script sets the proxy URL and
the Learn pin, prunes the export to the embedded languages, and bundles the
semantic search stack before `tauri build` wraps it:

```bash
npm run build --workspace @alice-wallet/app-desktop
```

Alice Wallet, PWA:

```bash
cd apps/wallet-mobile && npm run build:pwa
```

Alice Wallet, Android:

```bash
cd apps/wallet-mobile && npx eas-cli@latest build --profile preview --platform android
```

The Android command requires an Expo account with access to the Alice project.
It is for authorised release operators only and does not deploy the Worker.

The website (`SITE_IS_PUBLIC` in `apps/site/src/lib/site.ts` gates the
go-live surfaces):

```bash
npm run build --workspace @alice-wallet/site
```

Before a release, record the shared version, commit, and known limits in
`CHANGELOG.md`, update every release declaration, and add the highlights to
`packages/alice-ai/src/whats-new.ts`. Do not maintain that file list by hand.
`npm run check:release-version` covers the package and lock manifests, Expo,
EAS, Tauri, the native Cargo crate, the Worker endpoint, the example
environments, the changelog, and the in-app notes. Then run the platform QA
checklist in [docs/RELEASE_QA.md](docs/RELEASE_QA.md). Do not deploy or push a
release merely because a local build succeeded.
