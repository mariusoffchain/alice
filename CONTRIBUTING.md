# Contributing to Alice

Thanks for your interest in Alice.

Alice is in mainnet beta and handles real funds. Contributions should
preserve user safety, privacy, and the separation between AI assistance and
wallet spending authority.

## Ground Rules

- Do not change mainnet behavior unless it is explicitly reviewed and approved.
- Do not log, upload, or expose recovery phrases, mnemonics, private keys, balances, or full wallet history.
- Do not let AI code sign or broadcast transactions without explicit user confirmation through wallet-controlled flows.
- Keep wallet logic deterministic and auditable.
- Prefer small focused pull requests.

## License of contributions

By submitting a contribution, you agree to license it under
`AGPL-3.0-or-later`, the license that applies to Alice. You retain copyright in
your contribution.

## Development Checks

Before opening a pull request, run:

```bash
npm test
```

When changing Alice prompts or instruction handling, also run:

```bash
node apps/wallet-mobile/scripts/check-ai-system-prompt.js
```

When touching AI or wallet modules, check the AI/wallet boundary:

```bash
cd apps/wallet-mobile && npm run check:ai-boundary
```

## Issues

When reporting a bug, include:

- platform: Web, PWA, Android, iOS, or Desktop;
- app version or commit;
- expected behavior;
- actual behavior;
- steps to reproduce;
- screenshots only if they do not reveal sensitive data.

Never include seed phrases, private keys, real invoices tied to private activity, or screenshots containing sensitive wallet data.
