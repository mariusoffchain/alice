# Dependency audit

Alice uses a lockfile and runs `npm audit` in CI after a clean install. The CI
fails on any critical vulnerability, any high-severity package or advisory not
in the reviewed baseline, and when that baseline expires.

## Current reviewed baseline

The release check on 2026-08-21 reports 23 high findings and 0 critical. Every
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

The baseline expires on 2026-09-19. It is not a waiver: before that date each
chain must be upgraded, replaced, or explicitly reviewed with evidence that a
breaking migration would create more risk than it removes.

No `npm audit fix --force` is applied automatically. Its current proposals
include a major Next upgrade and a Satora downgrade, neither of which is safe
inside the beta release freeze.
