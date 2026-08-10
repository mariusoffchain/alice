# Changelog

Alice ships as four surfaces from one repository, and they are versioned
together: a single number means a tester and a log line refer to the same code.

- `0.1.0` — current closed beta
- `0.0.1` — first public baseline
- `1.0.0` — public launch, planned

## 0.1.0

First closed-beta release built from a validated public source tree.

- All official Web deployments now build from the public `alice` repository.
- Android release builds use `https://proxy.alicebtc.com` and contain no
  provider API key or bundled local language model.
- Alice Memory questions use local memories without triggering unrelated
  Bitcoin retrieval or pedagogical context.
- Labeled raw hexadecimal private keys are blocked before any model call,
  while explicitly labeled transaction IDs remain accepted.
- The Desktop production build uses the official Private Cloud proxy by
  default and still allows an explicit development override.
- Local benchmark diagnostics expose only numeric timing and throughput
  metrics, with no conversation or wallet content.
- The local admin allowlist is loaded from a quoted `.dev.vars` value so the
  username separator cannot be interpreted as a dotenv comment.
- The `v0.0.1` public snapshot has a completed OpenTimestamps proof anchored
  in Bitcoin block `961792`.

## 0.0.1

First frozen and publicly tagged baseline. The distributable Android build was
still produced before the public snapshot; `0.1.0` is the first release that
closes that provenance gap.

### All surfaces

- **Sign-in reduced to one path.** Email with a verification code, a username
  and a password. Passkey, Nostr and account-key sign-in were removed —
  12 Worker routes, 9 client modules, 4127 lines. Checked against production
  first: two identities, both email, zero passkey credentials.
- **21 free Private Cloud requests without an account**, and the remaining
  balance is now visible. It was fetched and then discarded for anonymous
  users, who are precisely the ones spending it.
- **Learning profile** (`What Alice knows about you`) on every surface, stored
  only on the device, holding counters and never any text from a question.
- **Privacy page** rewritten to describe what Alice actually stores.
- **No model ships with any app.** A local model is downloaded from Settings
  when the user chooses one. Removed a 769 MB GGUF from the Desktop bundle and
  another from every EAS upload.

### Wallet (Android)

- Private Cloud no longer answers every past question at once, in whichever
  language most of them were in. Venice does not encrypt assistant turns, so
  Alice drops them; the model now knows those replies existed.
- The keyboard no longer covers the message field and the send button.
- The microphone permission is gone. Alice has no audio dependency and records
  nothing; the permission only made the store listing claim otherwise.
- Wallet work carried in this baseline: coin control, address archives,
  delegated renewal, emergency exit, swap registry, VTXO lifecycle controls,
  live Arkade VTXO minimum, individually masked recovery words.

### Alice Web and Desktop

- Desktop opens on Private Cloud like every other surface. It used to open on
  the local backend with no model installed, wait fifteen seconds for a server
  nobody had started, then report a bundled model that no longer existed.
- Desktop keeps its downloadable local model, from Settings.
- Local AI stays unavailable on Alice Web: the browser cannot run it.

### Worker and admin console

- **Privacy-first admin console**, absent from production by construction —
  it runs only when `ADMIN_CONSOLE_ENABLED` is set, which it is not in
  production. Launched locally from a Desktop shortcut.
- Aggregate analytics only: day-resolution counters keyed by event, platform
  and app version. No per-user event stream, no durable IP record, no
  third-party analytics service.
- The console can never show a conversation, a seed, a wallet key, an account
  private key, a password or the content of an AI request. The internal user id
  is never exposed; the public username is the support identifier.
- Admin access is enforced by the server on all 18 routes, proven by
  adversarial tests from three attacker positions.
- Promo codes are admin-side only during the beta. Testers are given requests
  by adjusting credits on their account, which is recorded in the audit log.

### Database

Migrations `0001` through `0009` are applied to production D1. The release adds
no pending migration: every table the code reads exists, and none is orphaned.
Deploying the Worker for this baseline needs no migration step.

### Known limits

- Private Cloud attestation is at `attested-unpinned`, not `full`. Venice has
  not published the reference measurements. Full E2EE is required before any
  opening beyond the closed beta.
- Private Cloud remembers what was asked, not what Alice answered. A follow-up
  like "expand on that" stays approximate. Carrying an encrypted summary of the
  conversation is the real fix and is post-beta.
- Semantic RAG is validated on Android. Alice Web, the installable PWA and
  Desktop use lexical retrieval over the same knowledge base in this beta.
- `npm audit` reports transitive vulnerabilities in the frozen build stack,
  none critical. The reviewed baseline, per-chain exposure analysis and
  expiry date are maintained in `docs/security/dependency-audit.md`.
