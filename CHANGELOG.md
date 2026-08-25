# Changelog

Alice ships as four surfaces from one repository, and they are versioned
together: a single number means a tester and a log line refer to the same code.

- `0.2.1`, current release
- `0.2.0`, previous release
- `0.1.0`, previous closed beta
- `0.0.1`, first public baseline
- `1.0.0`, public launch, planned

## 0.2.1

A desktop repair release. The Android build is unchanged and stays on `0.2.0`.

### Desktop: the installed app can reach the servers it needs

The packaged app declares which servers it is allowed to contact, and that
list had never grown past the AI services. Every chain endpoint was missing,
so the Explorer returned nothing at all in the installed app while the same
code worked in a browser, and Learn cover art never loaded. The list now
carries the Explorer's default nodes and their fallbacks, the Arkade
endpoints, the packs CDN, and Intel's certificate services, which the Private
Cloud verification uses as a fallback.

A node a user configures themselves is still refused by that list. Moving
these requests outside the webview, which also opens the way to Tor, is the
next step rather than a wider list.

### Private Cloud: a refusal says which refusal

"Security verification is temporarily unavailable" covered three different
failures, and two of them never repair themselves, so the advice to wait was
false. They are now distinguished: a service in difficulty, a request that
never completed, and an answer that could not be used. Each carries one line
of technical cause under the message, drawn from a closed vocabulary that can
never include a server message, a prompt, a response or a key, so a report can
name the cause instead of the symptom.

### macOS install instructions

The download notice and the beta guide described the right-click Open
shortcut, which macOS 15 removed. They now describe the dialog people actually
see and the Privacy & Security path that grants the permission.

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
- Lightning swaps work again: Satora now requires its client to declare the
  server API it was built for, and the SDK the wallet shipped with predated
  that rule. Updated to the current SDK, so 0.1.0 users should update.
- Paying a Lightning invoice quotes the exact routing fee for that invoice
  (Satora's dedicated endpoint) instead of an average, so the amount you
  confirm is the amount the swap charges: the recipient gets the invoice
  amount, fees ride on top and are shown before sending. Satora's own
  refusals are now shown as such ("invoices must expire within 24 hours",
  "this invoice already has a swap") instead of a false "server unreachable",
  and the wallet checks the invoice lifetime before asking. Only refusals
  the wallet recognises are shown in Satora's terms; any other server
  message is replaced by a generic refusal with its status and kept, without
  URLs, in the diagnostic log.
- Creating a wallet shows the welcome at once; connecting to the Ark server
  happens in the background, as Arkade Wallet does, instead of holding the
  screen until the server answers.
- A new wallet is created offline. Its keys never needed the network; only
  the balance does, and the home screen says "offline" at once instead of
  waiting out a connection timeout, then fetches it once a connection exists.
- Creating a wallet after an abandoned import now really creates a new
  wallet. The app could keep serving the previously imported wallet while
  the stored phrase, and the backup screen, already held the new one; every
  new phrase now starts from nothing (backend, local index, swap records).
  A connection still in progress when the phrase changes is discarded on
  arrival rather than stored, so the window between "Create" and the
  server's answer cannot bring the previous wallet back either.
- Recovery scans the SDK's default window of 20 unused addresses first,
  shows the wallet as soon as something is found, and still runs the deep
  window of 100 in the background (at once, and blocking, when nothing
  turned up), so funds beyond a wider gap are never missed. It retries its
  network scan when some lookups fail instead of stopping at "discovery
  handlers failed", says so plainly if it still cannot finish, and the
  screen says "restoring" rather than "generating keys" while it runs. An
  imported wallet counts as onboarded only once its recovery finished. A
  deep pass that did not finish is remembered: the home screen shows
  "Recovery scan incomplete" with a retry, the scan resumes at the next
  launch, and the address page only says "rescan complete" once the deep
  window really ran. The welcome screen no longer jumps to the wallet on
  its own; the Start button is the only way forward.
- The welcome after key creation (Alice, her message, the Start button) now
  actually appears on Android. A layout signal could stop the fill animation
  mid-way and leave the screen blue with the welcome at opacity zero.
- "View in explorer" opens Alice Explorer, Bitcoin or Arkade view, instead
  of a third-party site. Alice Explorer accepts a subject in its URL for
  that: `/explorer?tx=<id>&network=<mainnet|arkade|mutinynet>`, also
  `address=`, `block=`, `xpub=`.
- Secondary texts (receive hints, model descriptions, theme hints, address
  buttons, coin-control counters) move to the body font, readable at a
  glance; the pixel font is kept for titles and actions.
- Less work on the JS thread, so taps answer faster: the home screen
  refreshes in one sequential pass every 30 s instead of three racing chains
  every 10 s, the history only polls while a transaction is still moving,
  and the knowledge corpus (2 000+ chunks) loads after the first
  interactions rather than at launch. The first question to Alice pays that
  load once. Offline, the home screen stops polling and refreshes the moment
  the connection is back; the Send scanner stops when another screen covers
  it.

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

### Breaking for 0.1.0 testers: a new Android application id

The wallet's Android identifier moves from the maintainer's company name to
`com.alicebtc.wallet`. Android treats this as a different app: 0.2.0 does
not install over 0.1.0. Write down your recovery phrase in 0.1.0, install
0.2.0, import the phrase, then uninstall 0.1.0. Nothing on the server side
depends on the identifier.

### Known limits, updated

- Paying a Lightning invoice through Satora requires an invoice that expires
  within 24 hours. Some wallets (Spark-based ones among them) issue longer
  invoices by default; ask the recipient for a shorter one. An invoice issued
  by Satora itself cannot be paid through Satora.

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
