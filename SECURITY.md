# Security Policy

Alice is in mainnet beta.

## Use Small Amounts

Use only small amounts while Alice is being validated. Do not rely on it for
funds you cannot afford to lose.

## Scope

This policy covers the code in this repository (Alice Wallet, Alice App web
and desktop, the website, the Private Cloud proxy Worker) and the
`alicebtc.com` services it runs. Reports we care about most, because they
attack what Alice promises:

- anything that lets AI code reach keys, signing or payment execution;
- exfiltration of a recovery phrase, private key, or chat content;
- breaks in the Private Cloud encryption path or its attestation checks
  (see [docs/security/private-cloud-e2ee.md](docs/security/private-cloud-e2ee.md));
- account takeover, session confusion, or quota/faucet abuse beyond the
  documented limits.

The threat model in
[docs/security/THREAT_MODEL.md](docs/security/THREAT_MODEL.md) states what is
in and out of scope in more detail. Third-party services Alice uses (Venice,
Arkade, Boltz, Satora, Esplora) have their own programs; reports about their
infrastructure belong to them.

## Reporting Security Issues

Write to [contact@alicebtc.com](mailto:contact@alicebtc.com) with the subject
line `Alice security report`.

**Please report privately rather than in a public issue.** A public issue is
readable by everyone the moment it is posted, including by whoever would abuse
the flaw, while the fix is still being written and users are still running the
vulnerable build. Reporting privately gives the fix a chance to ship first. It
is the only reason for asking, and once a fix is out, the finding can be
discussed in the open.

You will get an acknowledgement within seven days. There is no bug bounty
during the beta; with your agreement, fixed reports are credited in the
release notes.

The same address is fine for product feedback and account questions. Only the
subject line changes, and it is what routes a security report to the top of
the pile.

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
