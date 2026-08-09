# Dependency audit

Alice uses a lockfile and runs `npm audit` in CI after a clean install. The CI
fails on any critical vulnerability, any high-severity package or advisory not
in the reviewed baseline, and when that baseline expires.

## Current reviewed baseline

As of 2026-08-09, `npm audit` reports 43 advisories: 2 low, 15 moderate, 26
high and 0 critical. Every high finding is transitive, and every chain was
re-reviewed on that date. They fall into two groups:

- **Build and test tooling only** — the Expo/Metro/React Native CLI chain
  (`metro`, `@expo/cli`, `image-size`, `js-yaml` via `@expo/xcpretty` and
  `babel-jest`, `fast-uri` via `ajv` inside `expo-build-properties`), plus
  Next/PostCSS/Tailwind build dependencies. This code runs on a developer or
  CI machine against Alice's own files; it never ships in a client bundle and
  parses no attacker-controlled input.
- **Runtime-reachable but not exploitable in our usage** — `nanoid`
  (advisory concerns custom generators; Alice's dependency chain only calls
  the standard generator), and the previously reviewed inference/payment
  chains (Hugging Face Transformers, ONNX Runtime, Arkade/Satora).

The baseline expires on 2026-09-08. It is not a waiver: before that date each
chain must be upgraded, replaced, or explicitly reviewed with evidence that a
breaking migration would create more risk than it removes.

No `npm audit fix --force` is applied automatically. Its current proposals
include a major Next upgrade and a Satora downgrade, neither of which is safe
inside the beta release freeze.
