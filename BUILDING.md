# Building Alice

This document describes a reproducible local build from a clean checkout. It
does not grant access to production services, signing keys, or deployment
credentials.

## Requirements

- Node.js `>=22.12.0 <25` (Node `24` LTS recommended)
- npm compatible with the committed `package-lock.json`
- Android Studio and an Android SDK for native Android builds
- Rust and the Tauri platform requirements for Desktop builds

## Clean install and checks

From the repository root:

```bash
npm ci
npm test
```

`package-lock.json` is the dependency source of truth. Do not replace `npm ci`
with an unconstrained dependency update while reproducing a release.

## Local configuration

Copy `.env.example` for local development. The sample files contain no usable
secret. Distributed builds use Alice's Private Cloud proxy and must never embed
the Venice production API key.

The Worker keeps its secrets outside Git through Wrangler secrets. Do not copy
production `.env` files, `.dev.vars`, signing credentials, D1 exports, or test
account data into an issue, pull request, or release artifact.

## Surface builds

Build commands depend on the target surface:

```bash
npm run build --workspace @alice-wallet/app-web
```

```bash
npm run build --workspace @alice-wallet/app-desktop
```

```bash
cd apps/wallet-mobile && npx eas-cli@latest build --profile preview --platform android
```

The Android command requires an Expo account with access to the Alice project.
It is for authorised release operators only and does not deploy the Worker.

Before a release, record the shared version, commit, and known limits in
`CHANGELOG.md`, then run the platform QA checklist. Do not deploy or push a
release merely because a local build succeeded.
