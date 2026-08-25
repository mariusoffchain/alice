# Alice

Alice is a private AI companion for Bitcoin. She answers your questions,
explains what you are looking at on the chain, and teaches you the subject at
your own pace. She runs on your device or through encrypted inference you can
verify, and she never sees your keys.

**Alice App** is the companion: a chat that knows Bitcoin, an Explorer that
reads the chain in plain words, a Learn library of courses, and a Playground
where you practise real wallet moves with coins that are worth nothing.

**Alice Wallet** is the separate, self-custodial wallet, currently in mainnet
beta and validated with small amounts only. It is a companion piece, not the
way into Alice.

## What Alice can never see

Security and privacy are not a section of this project; they are its shape.
The full details live in [docs/security/](docs/security/), but the summary
belongs here, up front.

**Data that can never be collected**, impossible by construction rather than
by promise:

- your recovery phrase, wallet keys, balances and transaction history: the
  server never receives them;
- your conversations with Alice: questions are encrypted on your device
  before they reach our proxy, and answers are decrypted on your device;
- your passwords: only salted hashes are stored;
- your IP address as a durable record: it is hashed with a key that changes
  every day, then forgotten. That protects it on our side, and a VPN protects
  it from everyone else you connect to, which we recommend.

**Data we do collect**, the complete list and nothing else:

- account data: a one-way fingerprint of your email (never the address
  itself, we store a masked display form like `sat****@bitcoin.com`), your
  username, and quota counters for Private Cloud;
- aggregate, day-level product counters (app opened, chat opened…) keyed only
  by day, platform and app version, never by user, session or device;
- whatever you explicitly put in a support report.

**Data third parties see because Alice uses them**, each provider seeing only
its own slice: Cloudflare relays encrypted AI traffic, hosts our DNS, and
counts page views on the website (cookieless, no fingerprint, site
only, never in the app);
Venice runs AI inference inside a hardware enclave and receives ciphertext;
Arkade, Boltz and Satora execute the payments you ask for; Esplora (a
blockchain-explorer API) answers on-chain lookups; Resend delivers login-code
emails; Hugging Face serves the semantic-search model to web builds (fetched
on your first question, never on a data-saving connection, and the installed
desktop app carries it and asks Hugging Face nothing) and the optional local
chat models; jsDelivr serves downloadable Learn languages and course art;
GitHub serves course images from Plan ₿ Network's repository. What a CDN
sees is the classic slice: your IP address and which files you fetch. None
of these providers receives your seed or your chat history in clear.

**The AI/wallet boundary**: the AI code cannot import wallet custody,
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
  (a TEE, a processor mode that isolates code and memory from its own host),
  and that the encryption key is bound to that enclave. What Alice cannot yet
  verify is *which* enclave image runs, because Venice has not published
  reference measurements. Until then, the UI must not claim full end-to-end
  encryption. Details: [docs/security/private-cloud-e2ee.md](docs/security/private-cloud-e2ee.md).
- **E2EE turns are single-shot.** Venice does not encrypt assistant replies,
  so Alice drops them from the context instead of leaking them back.
- **Semantic search runs on Android, Alice App web and Desktop, but not on
  the installable PWA.** Where it runs, retrieval is hybrid: keyword matching
  fused with an on-device embedding model, and it falls back to keywords
  alone, silently, whenever the model is not loaded. The PWA stays on
  keyword retrieval because its bundler cannot load the ONNX runtime (the
  exact error is documented in the code). Result quality has been validated
  on Android; the web engine runs the same model over the same index.
- **External services fail visibly.** If Arkade, Boltz, Satora or Esplora is
  down, Alice reports it rather than silently switching payment rails.

The broader map is in [docs/security/THREAT_MODEL.md](docs/security/THREAT_MODEL.md).

## What's in the app

Alice App is more than the chat:

- **Chat**: the companion itself, over a built-in Bitcoin knowledge base
  (retrieval described under Honest limits above).
- **Explorer**: blocks, transactions, addresses and xpubs, explained by
  Alice instead of dumped as hex.
- **Learn**: the [Plan ₿ Network](https://planb.network) educational corpus
  (CC BY-SA 4.0), reshaped into per-language packs. English and French ship
  in the app; 27 more languages download on demand from
  [alice-learn-planb-packs](https://github.com/mariusoffchain/alice-learn-planb-packs).
  Alice never rewrites the teaching text; she explains it when you get stuck.
- **Playground**: a practice wallet on Mutinynet (a Bitcoin test network
  whose coins are worthless by design): real wallet mechanics, zero risk.

## Trying Alice

- [Alice App](https://app.alicebtc.com), the companion, in any browser
- [Alice Wallet](https://wallet.alicebtc.com), mainnet beta, real funds,
  small amounts only ("Web wallet" in the site's download menu)
- [Alice Mutinynet](https://mutinynet.alicebtc.com), the wallet on a test
  network: a test environment for wallet flows. For learning and practising,
  use the Playground inside Alice App.
- Android: APK through the closed-beta channel, see
  [docs/BETA_TESTING.md](docs/BETA_TESTING.md)

Do not rely on a URL alone to identify a build: check its version and commit.
Never share your recovery phrase, and never send it to Alice: she will never
ask for it.

An Alice account (email + username + password) is optional; it exists only to
manage Private Cloud quotas. 21 free Private Cloud requests are available
without any account. The wallet itself never needs an account.

## AI modes

- **Private Cloud**: encrypted inference through Alice's blind proxy (a
  Cloudflare Worker in [apps/venice-proxy-worker](apps/venice-proxy-worker)).
  The proxy holds the Venice API key server-side and relays ciphertext; no
  client build ever contains the key.
- **Local**: a model file (GGUF) downloaded from Settings and run entirely
  on your device. No chat model is preinstalled in any build. (The desktop
  installer does include the small semantic-search embedding model, so
  knowledge retrieval works offline out of the box; web builds fetch it on
  first use instead.)
- **Custom**: your own OpenAI-compatible endpoint.

## Repository map

```
apps/wallet-mobile        Alice Wallet (Expo/React Native: Android, PWA)
apps/app-web              Alice App (Next.js static export: web, and the
                          desktop shell's frontend)
apps/app-desktop          Alice App desktop shell (Tauri)
apps/site                 alicebtc.com (Next.js static export)
apps/venice-proxy-worker  Private Cloud blind proxy (Cloudflare Worker)
packages/alice-ai         AI companion: chat, RAG, E2EE, memory
packages/alice-content    knowledge base and generated Learn catalog
packages/practice-wallet  the Playground's Mutinynet wallet logic
packages/wallet-core      wallet primitives shared across surfaces
packages/alice-ui         shared UI primitives
packages/shared-types     types shared across packages
```

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

Unit tests, from the repository root:

```bash
npm test
```

CI runs that plus the dependency-audit gate; run both before pushing:

```bash
npm run check:npm-audit
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
testable this way: anything importing `expo/*` or `react-native` cannot be
loaded outside Metro.

Check Alice prompt constraints when changing prompt or instruction handling:

```bash
node apps/wallet-mobile/scripts/check-ai-system-prompt.js
```

For the reproducible release checklist across web, Android and Desktop, see
[BUILDING.md](BUILDING.md). Never place production secrets in a client build.

### Alice App, desktop build (Tauri)

Start the Next dev server first, then the desktop shell. `beforeDevCommand`
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
