# Alice

Alice is a private AI companion for Bitcoin. She lives in two places: Alice
Wallet, a self-custodial wallet that holds your keys on your device and moves
money over Bitcoin, Arkade and Lightning with Alice built in; and Alice App, the
standalone companion for desktop and web. Across both, Alice explains what is
happening and answers your Bitcoin questions, without ever touching your keys.

Current status: **mainnet beta**. Use small amounts only while the product is
being validated.

## What Alice can never see

Security and privacy are not a section of this project; they are its shape.
The full details live in [docs/security/](docs/security/), but the summary
belongs here, up front.

**Data that can never be collected** — impossible by construction, not by
promise:

- your recovery phrase, wallet keys, balances and transaction history — the
  server never receives them;
- your conversations with Alice — questions are encrypted on your device
  before they reach our proxy, and answers are decrypted on your device;
- your passwords — only salted hashes are stored;
- your IP address as a durable record — it is hashed with a key that changes
  every day, then forgotten.

**Data we do collect** — the complete list, nothing else:

- account data: a one-way fingerprint of your email (never the address
  itself — we store a masked display form like `ma****@domain.com`), your
  username, and quota counters for Private Cloud;
- aggregate, day-level product counters (app opened, chat opened…) keyed only
  by day, platform and app version — never by user, session or device;
- whatever you explicitly put in a support report.

**Data third parties see because Alice uses them** — each provider sees only
its own slice: Cloudflare relays encrypted AI traffic and hosts our DNS;
Venice runs AI inference inside a hardware enclave and receives ciphertext;
Arkade, Boltz and Satora execute the payments you ask for; Esplora (a
blockchain-explorer API) answers on-chain lookups; Resend delivers login-code
emails; Hugging Face serves optional model downloads. None of them receives
your seed or your chat history in clear.

**The AI/wallet boundary** — the AI code cannot import wallet custody,
signing or payment modules, and the wallet code cannot import AI modules.
This is enforced by an automated check, not by convention:

```bash
cd apps/wallet-mobile && npm run check:ai-boundary
```

Recovery phrases and private keys pasted into chat are blocked before they
can be stored or sent to any AI backend.

## Honest limits, stated plainly

- **Private Cloud is "attested, but not pinned."** Alice verifies that
  Venice's AI runs inside a genuine, current, non-debug TDX hardware enclave
  (a TEE — a processor mode that isolates code and memory from its own host),
  and that the encryption key is bound to that enclave. What Alice cannot yet
  verify is *which* enclave image runs, because Venice has not published
  reference measurements. Until then, the UI must not claim full end-to-end
  encryption. Details: [docs/security/private-cloud-e2ee.md](docs/security/private-cloud-e2ee.md).
- **E2EE turns are single-shot.** Venice does not encrypt assistant replies,
  so Alice drops them from the context instead of leaking them back.
- **Semantic search is currently validated only on Android.** Alice Web, the
  installable PWA and Desktop use keyword (lexical) retrieval over the same
  knowledge base. Their semantic indexes are prepared, but the Web runtime is
  not enabled in this beta because of a bundler limitation.
- **External services fail visibly.** If Arkade, Boltz, Satora or Esplora is
  down, Alice reports it rather than silently switching payment rails.

The broader map is in [docs/security/THREAT_MODEL.md](docs/security/THREAT_MODEL.md).

## Trying Alice

- [Alice Web](https://app.alicebtc.com)
- [Alice mainnet beta](https://wallet.alicebtc.com)
- [Alice Mutinynet](https://mutinynet.alicebtc.com) (test network)
- Android: APK through the closed-beta channel — see
  [docs/BETA_TESTING.md](docs/BETA_TESTING.md)

Do not rely on a URL alone to identify a build: check its version and commit.
Never share your recovery phrase, and never send it to Alice — she will never
ask for it.

An Alice account (email + username + password) is optional; it exists only to
manage Private Cloud quotas. 21 free Private Cloud requests are available
without any account. The wallet itself never needs an account.

## AI modes

- **Private Cloud** — encrypted inference through Alice's blind proxy (a
  Cloudflare Worker in [apps/venice-proxy-worker](apps/venice-proxy-worker)).
  The proxy holds the Venice API key server-side and relays ciphertext; no
  client build ever contains the key.
- **Local** — a model file (GGUF) downloaded from Settings and run entirely
  on your device. No model ships inside any app.
- **Custom** — your own OpenAI-compatible endpoint.

## Development

Use Node.js `>=22.12.0 <25` (Node `24` LTS is recommended). The lockfile is
the source of truth for a reproducible dependency tree.

```bash
npm ci
```

Start Expo (mobile/PWA development):

```bash
cd apps/wallet-mobile && npm start
```

Build the PWA:

```bash
cd apps/wallet-mobile && npm run build:pwa
```

Unit tests, from the repository root — this is the check CI runs:

```bash
npm test
```

Type-checking runs per workspace (each app and package carries its own
`tsconfig.json`; Next and Expo check their app during their builds). A single
repo-wide `tsc` pass is not wired up yet. For the pure packages:

```bash
npx tsc --noEmit -p packages/alice-ai
```

Tests use Node's built-in runner (`node --test`) on the TypeScript sources
directly, so there is no test framework to install and no build step. One
constraint follows: Node resolves ES module specifiers literally, so imports
carry an explicit extension (`./venice-errors.ts`). Only pure modules are
testable this way — anything importing `expo/*` or `react-native` cannot be
loaded outside Metro.

Check Alice prompt constraints when changing prompt or instruction handling:

```bash
node apps/wallet-mobile/scripts/check-ai-system-prompt.js
```

For the reproducible release checklist across web, Android and Desktop, see
[BUILDING.md](BUILDING.md). Never place production secrets in a client build.

### Alice App, desktop build (Tauri)

Start the Next dev server first, then the desktop shell — `beforeDevCommand`
is empty on purpose, so `tauri dev` never builds the web app itself:

```bash
npm run dev --workspace apps/app-web
```

```bash
npm run dev --workspace apps/app-desktop
```

How the frontend is served differs between the two modes, and the difference
matters:

- **dev** loads `devUrl` (`http://localhost:3000`), so web changes hot-reload.
- **prod** embeds `apps/app-web/out`, produced by `beforeBuildCommand`.

Which one applies is decided at compile time by the `custom-protocol` Cargo
feature. It must stay declared as a **package** feature in
`apps/app-desktop/src-tauri/Cargo.toml`:

```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

Enabling it directly on the `tauri` dependency instead leaves nothing for
`tauri dev`'s `cargo run --no-default-features` to switch off, so the desktop
app silently serves a stale `out/` snapshot and ignores the dev server.

One consequence to expect: the two modes have different web origins
(`http://localhost:3000` in dev, `tauri://localhost` in prod), so they use
different `localStorage`. Conversation history and AI settings do not carry
over between a dev run and an installed build.

### Environment

Copy `.env.example` to `.env` and adjust when needed:

```bash
cp .env.example .env
```

Never commit `.env`. Every distributed build, including Android and Desktop,
routes Private Cloud through `EXPO_PUBLIC_VENICE_PROXY_URL`
(`https://proxy.alicebtc.com` for official builds): an APK or desktop binary
can be inspected, so none may contain the Venice API key. Direct Venice calls
exist only for explicit internal diagnostics with a personal, revocable key.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md)
first. Report security issues privately to
[contact@alicebtc.com](mailto:contact@alicebtc.com).

## License

Alice is licensed under [GNU AGPL-3.0-or-later](LICENSE). See
[NOTICE](NOTICE) for copyright and third-party notices, and
[TRADEMARKS.md](TRADEMARKS.md) for the separate rules governing the Alice
name and visual identity.
