# Release QA checklist

What to try by hand before publishing a release, on the artefacts that will
actually be distributed. Automated tests cover the logic; this list covers
what only a human holding a phone can see.

Work through it on the **built** artefacts, never on a dev server: a dev build
resolves paths, versions and origins differently, and those differences are
exactly where release bugs hide.

Have ready: an Android phone, a second browser or a private window, and a few
thousand Mutinynet sats in the Playground.

---

## 0. Before starting

- [ ] The version number is the same in the app menu, the release tag and the
      Worker (`GET https://proxy.alicebtc.com/app-version`).
- [ ] `npm test`, `npm run check:types`, `npm run check:release-version` and
      `npm run check:npm-audit` pass on the commit being shipped.
- [ ] The public snapshot rehearses clean (no personal path, no internal doc).

---

## 1. Alice App, web

- [ ] The four sections open: Chat, Explorer, Learn, Playground.
- [ ] Ask a question and get an answer. Ask a second one in French and the
      answer comes back in French.
- [ ] Ask "what is the Playground?", the answer must describe the practice
      wallet on a test network, not invent something.
- [ ] Learn opens a course, and the reading-language picker offers English and
      French as included, others as downloadable.
- [ ] Explorer looks up a block and a transaction.
- [ ] Settings › AI shows the semantic search section, with its real state.
- [ ] Nothing downloads the semantic model until the first question is asked
      (check the network panel on a fresh profile).

## 2. Alice App, desktop

- [ ] The installer opens and the app launches.
- [ ] **Cut the network, then ask a question.** The answer is lexical but it
      comes. The semantic model must be bundled, so no download is attempted.
- [ ] Learn opens an English course offline, and asks for the network only when
      a downloadable language is chosen.
- [ ] Settings says the model is included with the desktop app, not that it
      needs downloading.
- [ ] Conversations survive closing and reopening the app.

## 3. Alice Wallet, Android APK

- [ ] The APK installs from the release page and its checksum matches.
- [ ] Create a wallet, write the recovery phrase, pass the verification step.
- [ ] The red backup banner disappears once the phrase is confirmed.
- [ ] Receive: an address and a QR appear, and an amount can be requested.
- [ ] Restore the same wallet on a second device from the phrase alone, and the
      balance reappears.
- [ ] Ask Alice a question from inside the wallet; the answer arrives.
- [ ] Settings shows the account, the plan and the remaining free requests.

## 4. Alice Wallet, PWA

- [ ] Installing to the home screen works, and the app opens standalone.
- [ ] Same wallet flows as Android: create, back up, receive.
- [ ] The AI answers. Semantic search is deliberately absent here: the settings
      must not offer a button that does nothing.

## 5. Real payment paths

The only part no test can prove. Small amounts, and on Mutinynet first.

- [ ] **Playground faucet**: a fresh install receives its practice coins once,
      and asking twice is refused with a clear message.
- [ ] **Playground send**: send to another address, the transaction appears in
      Explorer on Mutinynet.
- [ ] **MAX**: sends the whole balance, and the amount that arrives matches the
      amount shown after pressing MAX.
- [ ] **Satora swap** (never validated end to end): perform one Lightning
      payment from the wallet and confirm it settles. If it fails, capture the
      error message before retrying.
- [ ] **Mainnet**: one small real payment, and one receive. Small means an
      amount you would shrug at losing.

## 6. What the release claims

Read the release notes and check each claim against the app you just used.

- [ ] Every feature announced exists and is reachable.
- [ ] Every known limit in the notes is still true.
- [ ] The site's download menu points at builds that exist.

---

## If something fails

Note the surface, the version, the exact steps and the message. Do not publish
around a failure by removing the claim from the notes: either the behaviour is
fixed, or the limit is stated plainly in "Known limits", which is what that
section is for.
