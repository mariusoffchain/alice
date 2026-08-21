# Changelog

Alice ships as four surfaces from one repository, and they are versioned
together: a single number means a tester and a log line refer to the same code.

- `0.2.0`, current release
- `0.1.0`, previous closed beta
- `0.0.1`, first public baseline
- `1.0.0`, public launch, planned

## 0.2.0

The beta grows from a chat with a wallet into a companion with rooms. This
entry covers the full span since `0.1.0`.

### Alice App: three new sections

- **Explorer.** Blocks, transactions, addresses and xpubs inside the app,
  explained by Alice. Entity attribution is served from its own database.
- **Learn.** The Plan ₿ Network educational corpus (CC BY-SA 4.0): courses
  with quizzes, tutorials, per-language packs. English and French ship in the
  app; 27 more languages download on demand from the public packs repository,
  pinned to one corpus commit. Course anchors link Learn and Explorer in both
  directions; a deterministic suggestion card under chat answers proposes the
  matching course; an Ask Alice panel reads the open course as context; Alice
  never rewrites the teaching text.
- **Playground** (formerly "test wallet", old links redirect). A practice
  wallet on Mutinynet with real wallet mechanics: backup flow identical to
  mobile, Sparrow-style single-view send with the transaction dissected,
  BIP21 receive with payment detection, coin control. An Alice faucet grants
  2,100 practice sats once per installation, no IP-based identity, IP is
  only day-bucketed for rate limiting. Bridges from chat, Learn and the
  resources block lead into it.

### Chat and retrieval

- **Semantic search left "Android only".** Retrieval is now hybrid (keyword +
  on-device embedding model) on Android, Alice App web and Desktop. The model
  downloads on the first question, never on a data-saving connection; a
  Settings section shows its state and can force or remove it. The desktop
  installer bundles model and ONNX runtime (~164 MB), so an installed build
  asks neither Hugging Face nor jsDelivr. The Expo PWA stays lexical: its
  bundler still cannot load the ONNX runtime (re-verified, error documented).
- Alice actually reuses what her memory retains, and finishing a course
  teaches the learning profile.
- A "To go further" resources block under answers; sidebar sections for the
  app's rooms; settings reorganized into tabs; a typography and color pass
  (pixel floor, palette-driven accents, contrast guard).

### Accounts, plans and payments

- Email is now account data, stored encrypted; sign-in back by email code;
  passwords actually gate the account; a session can no longer turn into
  another user's. Usernames are picked in three visible parts and can be
  changed later.
- Paid Cloud plan purchasable through BTCPay (prices pinned in satoshis, the
  euro shown as a landmark, not a price), with a persistent pending state. An
  exhausted quota reads as an offer, not an outage. The free path meters
  bytes without billing anything.
- Cloud+ and Deep Research were pulled from sale rather than left dormant.

### Wallet

- MAX sends everything, fees taken from the coins; each output is charged at
  its real size; reset is blocked while a swap is still recoverable.

### Site

- alicebtc.com carries the app in the page: interactive hero chat, a guided
  tour that mirrors the real UI (phone captures on mobile, with a wallet
  step), two-button nav (Open Alice / Download) with both products' platforms,
  a pricing page for the AI only, and Trust, Privacy and vs-ChatGPT pages
  that state only what is true.

### Worker and security

- Closed an installation-id replay that could drain the Venice balance, and
  the attestation gate no longer exposes its key to hammering.
- The public-snapshot script refuses to publish a tree naming local tooling,
  strips design-tool metadata from PNGs, and records which private commit
  produced each public branch.
- The npm-audit gate carries four reviewed fast-uri advisories, all on the
  same prebuild-only chain.

### Known limits, updated

- The `0.1.0` limit "semantic RAG validated on Android only" is superseded as
  described above; result quality remains validated on Android, the web
  engine runs the same model over the same index.
- Private Cloud attestation and single-shot E2EE turns: unchanged, see
  `0.0.1`.

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
  and a password. Passkey, Nostr and account-key sign-in were removed: 12
  Worker routes, 9 client modules, 4127 lines. Checked against production
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

- **Privacy-first admin console**, absent from production by construction:
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
