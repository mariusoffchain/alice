# Security Policy

Alice is in mainnet beta.

## Use Small Amounts

Use only small amounts while Alice is being validated. Do not rely on it for
funds you cannot afford to lose.

## Reporting Security Issues

Please do not open public issues for sensitive vulnerabilities.

Send sensitive vulnerability reports to [contact@alicebtc.com](mailto:contact@alicebtc.com)
with the subject line `Alice security report`. Do not use this address for
general product feedback or account support.

When reporting an issue:

- do not include seed phrases, mnemonics, private keys, or secrets;
- do not include screenshots exposing recovery phrases or sensitive wallet data;
- describe the impact and reproduction steps as safely as possible;
- include platform and version information.

## Sensitive Data Rules

Alice must never ask users to share:

- recovery phrases;
- private keys;
- wallet passwords or PINs;
- screenshots of backup screens;
- API keys or service credentials.

AI features must remain separated from wallet spending authority. The assistant may explain and prepare context, but payment execution must remain controlled by deterministic wallet code and explicit user confirmation.

## AI / Wallet Isolation

The AI core is intentionally text-only. It must not import wallet custody, signing, balance, or payment modules. The wallet core must not import AI or chat modules.

This boundary is checked by:

```bash
cd apps/wallet-mobile && npm run check:ai-boundary
```

Chat input is also screened before model inference. Recovery phrases and private keys are blocked before they can be stored in chat history or sent to local, cloud, or custom AI backends.

## Dependency Audit

The current dependency-audit policy and reviewed beta baseline are in
[docs/security/dependency-audit.md](docs/security/dependency-audit.md).
