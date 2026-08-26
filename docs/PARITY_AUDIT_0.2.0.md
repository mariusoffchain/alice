# Parity audit of the Alice surfaces for 0.2.0

Audit date: 2026-08-21
Branch: `app/parity-audit-0.2.0`
Scope: Alice App web, Alice App desktop, Alice Wallet Android, Alice Wallet PWA

## Executive result

Functional parity is solid because the surfaces are shared in pairs:

- App web and App desktop run the same exported Next frontend. Desktop adds the Tauri capabilities (`apps/app-desktop/src-tauri/tauri.conf.json:7`).
- Wallet Android and Wallet PWA run the same Expo routes. The `Platform.OS` branches stay limited to platform capabilities, namely local authentication, screen capture, clipboard and sharing (`apps/wallet-mobile/app/backup.tsx:31`, `apps/wallet-mobile/app/backup.tsx:51`, `apps/wallet-mobile/app/receive.tsx:311`, `apps/wallet-mobile/app/receive.tsx:456`).
- All 4 surfaces use the same `AccountProvider` and the same `ChatProvider` (`apps/app-web/src/lib/chat-provider.tsx:48`, `apps/wallet-mobile/app/_layout.tsx:170`).

The audit found 1 accidental gap, now fixed: Android had the native semantic search engine but no matching control in its settings. It also found 1 release blocker, common to the surfaces rather than a parity defect: the server announced `0.2.0` while several client manifests were still at `0.1.0`. The coordinated bump and its automatic check are now in place.

The small confirmed gaps were fixed in separate commits:

- `7c6907d` makes desktop open the release page from the update banner.
- `717143e` aligns the Wallet's email reminders with the App's rule and wording.
- `6a4e00f` removes the visual leftovers of the old Deep button from the Wallet and restores the "web wallet" / "Alice Wallet app" vocabulary.
- `d7b763e` deletes the residual promise of the brain button in the App settings.
- `8f97f4a` explicitly covers Local, Private Cloud and custom in the memory test.
- `565b909` gives the PWA build a default application version.
- `6d186b0` moves `fast-uri` from 3.1.2 to 3.1.5 after a new advisory of the same family was published during the audit. The chain stays limited to `expo-build-properties` → `ajv` → `fast-uri`, but the fixed version is now compatible with the existing constraint.

## Legend

- **Same**: same engine or same observable behaviour.
- **Intended difference**: a difference justified by the product or by a platform capability.
- **Accidental difference**: divergence with no matching platform constraint or product contract.
- **Not verified dynamically**: a conclusion drawn from the code and the tests, without running the 4 distributed binaries.

## 1. Chat and AI context

| Contract | App web | App desktop | Wallet Android | Wallet PWA | Verdict |
| --- | --- | --- | --- | --- | --- |
| Send, streaming, editing, regeneration, history | Shared `ChatProvider` (`packages/alice-ai/src/chat-context.tsx:253`, `packages/alice-ai/src/chat-context.tsx:530`) | Same frontend and same provider | Same provider | Same provider | **Same** |
| Initial backend and saved choice | Private Cloud by default, choice saved (`packages/alice-ai/src/chat-context.tsx:264`, `packages/alice-ai/src/chat-context.tsx:303`) | May prefer Local when Tauri makes it available (`packages/alice-ai/src/chat-context.tsx:318`) | Private Cloud by default | Private Cloud by default, Local unavailable | **Intended difference** |
| Response language | Resolved in common before generation (`packages/alice-ai/src/chat-context.tsx:579`) | Same | Same | Same | **Same** |
| Custom instructions | Injected by the shared core (`packages/alice-ai/src/chat-context.tsx:637`) | Same | Same | Same | **Same** |
| Personal memory | Injected into the generative history (`packages/alice-ai/src/turn-engine.ts:122`, `packages/alice-ai/src/generation-context.ts:81`) | Same | Same | Same | **Same**. The test covers Local, Private Cloud and custom (`packages/alice-ai/src/turn-engine.test.ts:95`). |
| Starter suggestions | 4 cards (`apps/app-web/src/components/ChatPanel.tsx:27`, `apps/app-web/src/components/ChatPanel.tsx:226`) | Same | Absent | Absent | **Intended difference, inferred**. They belong to the App's editorial landing, not to the Wallet's compact composer. |
| "To go further" | Learn, Explorer and Playground bridges (`apps/app-web/src/components/ChatPanel.tsx:102`, `apps/app-web/src/components/ChatPanel.tsx:259`) | Same | Absent | Absent | **Intended difference**. The destinations do not exist in the Wallet. |
| Per-message brain / Deep button | Absent | Absent | Absent | Absent | **Same**. The feature was removed. The `High` preset remains a reasoning budget, not another model (`packages/alice-ai/src/ai-preferences.ts:112`). The ghost labels and badges were deleted. |

Conclusion: the conversational engine is common to all 4 surfaces. The remaining differences are composition choices between the educational App and the Wallet.

## 2. Alice accounts

| Contract | App web | App desktop | Wallet Android | Wallet PWA | Verdict |
| --- | --- | --- | --- | --- | --- |
| Creation, email code, password sign-in, recovery | Web dialog wired to the shared provider (`apps/app-web/src/components/AccountPasswordDialog.tsx:13`, `apps/app-web/src/components/AccountPasswordDialog.tsx:435`) | Same | Native modal wired to the same provider (`apps/wallet-mobile/components/AccountPasswordModal.tsx:23`, `apps/wallet-mobile/components/AccountPasswordModal.tsx:308`) | Same Expo modal | **Functionally the same** |
| Rename, identities and deletion | Actions of the common provider (`packages/alice-ai/src/account-context.tsx:407`, `packages/alice-ai/src/account-context.tsx:421`, `packages/alice-ai/src/account-context.tsx:457`) | Same | Same | Same | **Same** |
| Plan and quotas | Plan, expiry, gauge and free quota (`apps/app-web/src/components/settings/AccountTab.tsx:153`) | Same | Same `cloudUsage` state and same free/paid distinction (`apps/wallet-mobile/app/account.tsx:75`) | Same | **Same** |
| Purchase and renewal | BTCPay checkout in the App (`apps/app-web/src/components/settings/PlanCheckout.tsx:63`) | Same web flow | Redirect to the web App (`apps/wallet-mobile/app/account.tsx:194`) | Same redirect | **Intended difference**. The Wallet does not sell the plan and keeps a single payment flow. |
| Expiry reminders | Information without a misleading switch (`apps/app-web/src/components/settings/RenewalReminders.tsx:13`, `apps/app-web/src/components/settings/RenewalReminders.tsx:34`) | Same | Wording and absence of a switch now aligned (`apps/wallet-mobile/app/account.tsx:219`) | Same | **Same after fix** |
| Payment confirmation | Screen and wait in the App flow | Same | Visible return once the account refreshes | Same | **Intended difference**, because checkout lives in the App. |

Account and quota logic is not duplicated. The two dialogs are distinct presentations of the same `AccountProvider` (`packages/alice-ai/src/account-context.tsx:93`).

## 3. Settings and models

| Contract | App web | App desktop | Wallet Android | Wallet PWA | Verdict |
| --- | --- | --- | --- | --- | --- |
| Main sections | General, Appearance, AI, Account, Explorer, Data (`apps/app-web/src/components/settings/tabs.tsx:74`) | Same | Account, Appearance, Customize Alice, App Lock, Advanced, About, Support (`apps/wallet-mobile/lib/settings-sections.ts:28`) | Same | **Intended difference** per product. |
| Advanced Wallet settings | Absent | Absent | Logs, server, coin control, addresses, renewal, swaps and exit (`apps/wallet-mobile/lib/advanced-sections.ts:28`) | Same where the web backend allows it | **Intended difference** |
| Local AI | An honest message in the browser (`apps/app-web/src/components/settings/AiTab.tsx:141`) | Local catalogue | Model download and management (`apps/wallet-mobile/app/ai-settings.tsx:342`) | A message about installing the Alice Wallet app (`apps/wallet-mobile/app/ai-settings.tsx:568`) | **Intended difference** |
| Private Cloud | Common activation | Same | Common activation (`apps/wallet-mobile/app/ai-settings.tsx:225`) | Same | **Same** |
| Custom server | URL, model and key (`apps/app-web/src/components/settings/AiTab.tsx:275`) | Same | Same trio and connection (`apps/wallet-mobile/app/ai-settings.tsx:577`) | Same | **Same** |
| Memory | Reading and clearing the memory and the profile (`apps/app-web/src/components/settings/AliceMemoryPanel.tsx:58`, `apps/app-web/src/components/settings/AliceMemoryPanel.tsx:80`) | Same | Same control (`apps/wallet-mobile/app/what-alice-knows.tsx:67`) | Same | **Same** |
| Instructions | Save and clear (`apps/app-web/src/components/settings/AiTab.tsx:189`) | Same | Same contract, announced for cloud, local and custom (`apps/wallet-mobile/app/ai-settings.tsx:298`) | Same | **Same** |
| Language | Setting shared under the same key | Same | UI in Customize Alice (`apps/wallet-mobile/app/ai-settings.tsx:265`) | Same | **Same**, different location. |
| Semantic search | Download, progress, stop and delete (`apps/app-web/src/components/settings/SemanticSearchSection.tsx:43`) | Model included, load button (`apps/app-web/src/components/settings/SemanticSearchSection.tsx:57`) | Engine active but no control in `ai-settings.tsx` | Engine explicitly unsupported | **Accidental difference on Android**, see open decisions. PWA is an intended difference. |

The wording present describes each surface's capabilities correctly, now that the residual promise of the brain button is gone. The existing privacy promises were not modified.

## 4. Local storage

### Logical keys

| Domain | Keys | App web / desktop | Wallet Android / PWA | Verdict |
| --- | --- | --- | --- | --- |
| Conversations | `alice_chat_sessions`, `alice_chat_session_*` (`packages/alice-ai/src/chat-storage.ts:4`) | Web AsyncStorage | Expo AsyncStorage | **Same** |
| Personal memory | `alice_personal_memory_v1` (`packages/alice-ai/src/alice-memory-storage.ts:4`, `packages/alice-ai/src/alice-memory-storage.native.ts:4`) | localStorage | SecureStore on Android, browser storage on PWA | **Logically the same** |
| Learning profile | `alice_learning_profile_v3`, migration from `alice_pedagogical_profile_v1` (`packages/alice-ai/src/pedagogical-profile-storage.ts:3`, `packages/alice-ai/src/pedagogical-profile-storage.native.ts:4`) | localStorage | SecureStore on Android, browser storage on PWA | **Logically the same** |
| Account session | `alice_account_session_v1`, `alice_install_id_v1`, `alice_pending_checkout_v1` (`packages/alice-ai/src/account-client.ts:14`) | Web AsyncStorage | SecureStore on Android, web AsyncStorage on PWA (`packages/alice-ai/src/account-session-storage.native.ts:3`) | **Logically the same**, with protection suited to the platform. |
| AI preferences | presets, models, instructions, language, activation, backends, custom server (`packages/alice-ai/src/ai-preferences.ts:121`, `packages/alice-ai/src/ai-preferences.ts:315`, `packages/alice-ai/src/ai-preferences.ts:379`) | Web AsyncStorage | Expo AsyncStorage | **Same** |
| Theme | `alice_theme_mode`, `alice_palette` (`apps/app-web/src/lib/theme-init.ts:6`, `packages/alice-ui/src/theme-context.tsx:5`) | localStorage | AsyncStorage | **Logically the same** |

### Protection at rest

- Desktop encrypts the conversations, the index, the personal memory and the learning profile through Tauri. The migration verifies each encryption before replacing anything (`packages/alice-ai/src/chat-storage.ts:54`, `packages/alice-ai/src/chat-storage.ts:111`).
- Android protects memory, profile and account session with SecureStore. The chat history stays in AsyncStorage without a `ChatStorageCipher` (`apps/wallet-mobile/app/_layout.tsx:171`).
- The 2 browser surfaces store locally with no application-level encryption.

This difference is **intended and documented for 0.2.0**, not a silent drift. The documentation says explicitly that conversation encryption is implemented on Desktop and that the Wallet adapters are still to be written (`docs/security/local-chat-encryption.md:3`, `docs/wallet-data-and-recovery.md:30`). No key needs renaming.

## 5. Learn, RAG and semantic search

| Contract | App web | App desktop | Wallet Android | Wallet PWA | Verdict |
| --- | --- | --- | --- | --- | --- |
| Core lexical RAG | Shared pack | Shared pack | Shared pack | Shared pack | **Same** |
| Learn context | Provider registered by the App (`apps/app-web/src/lib/chat-provider.tsx:31`) | Same | No provider | No provider | **Intended difference**. A surface without Learn returns `null` without altering the answer (`packages/alice-ai/src/learn-context.ts:31`). |
| Learn tolerance | 1.5 s budget and a neutral failure (`packages/alice-ai/src/learn-context.ts:17`) | Same | Not applicable | Not applicable | **Same for the surfaces concerned** |
| Semantic index | Public index plus browser model on the first question (`packages/alice-ai/src/semantic-runtime-browser.ts:1`) | Index and model embedded | Index embedded plus a model downloaded over Wi-Fi only (`packages/alice-ai/src/semantic-runtime.native.ts:81`, `packages/alice-ai/src/semantic-runtime.native.ts:128`) | Neutral lexical stub because of Metro (`packages/alice-ai/src/semantic-runtime.web.ts:4`) | **Intended difference**, except for the missing Android UI. |
| Corpus parity | Verified between the web and native indexes, ids, hash and dimensions included (`packages/alice-ai/src/rag-retrieval.integration.test.ts:59`) | Same | Same | Common lexical RAG | **Same** |
| Fallback | Lexical during loading or on error | Same | Lexical while the model is absent | Always lexical | **Same in principle**, different capability. |

The generated RAG artefacts were neither regenerated nor modified, in line with the scope.

## 6. Update notifications

The core is shared. It uses the same keys, limits requests to 1 every 6 h, fails silently, and does not show "What's new" on a first install (`packages/alice-ai/src/app-update.ts:18`, `packages/alice-ai/src/app-update.ts:48`, `packages/alice-ai/src/app-update.ts:71`).

| Surface | Action when a newer version exists | "What's new" | Verdict |
| --- | --- | --- | --- |
| App web | Reloads the page (`apps/app-web/src/components/AppUpdateNotices.tsx:95`) | Once per version | **Matches the contract** |
| App desktop | Opens the release page (`apps/app-web/src/components/AppUpdateNotices.tsx:79`) | Once per version | **Fixed** |
| Wallet Android | Opens the release page (`apps/wallet-mobile/components/AppUpdateNotices.tsx:46`) | Once per version | **Matches the contract** |
| Wallet PWA | Reloads the page (`apps/wallet-mobile/components/AppUpdateNotices.tsx:47`) | Once per version | **Fixed**. The build now fills the version from `app.json` when no variable is supplied (`apps/wallet-mobile/scripts/build-pwa.js:28`). |

Both components give priority to "What's new" and show one announcement at a time (`apps/app-web/src/components/AppUpdateNotices.tsx:63`, `apps/wallet-mobile/components/AppUpdateNotices.tsx:56`).

### Release blocker, fixed

The Worker already returned `0.2.0` while the monorepo, Expo, EAS production and Tauri still declared `0.1.0`. A 0.2.0 build would therefore have presented itself as 0.1.0 and immediately seen a 0.2.0 update.

Classification: **a common release step, fixed before distribution**, not a divergence between surfaces. The number is now `0.2.0` in the application manifests, the Cargo crate and lockfile, EAS, the environment examples, the Worker constant, the changelog and the in-app notes. `scripts/check-release-version.mjs` now refuses any divergence and runs at the start of `npm test`.

## 7. Wallet Android and PWA

The send, receive, coin control, archives, backup and reset screens are the same Expo files. The branches observed correspond to platform capabilities.

| Feature | Android | PWA | Verdict |
| --- | --- | --- | --- |
| MAX | Re-reads the available off-chain balance and refuses frozen funds (`apps/wallet-mobile/app/send.tsx:257`) | Same | **Same** |
| Validation and confirmation | Same parsing, same network checks, same quote/fee/total amounts (`apps/wallet-mobile/app/send.tsx:369`, `apps/wallet-mobile/app/send.tsx:802`) | Same | **Same** |
| Native mainnet exit through Satora | Used when the network is Bitcoin and Satora is available (`apps/wallet-mobile/app/send.tsx:409`) | Same | **Same** |
| Per-input and per-output fees | Sum of the input fees and a convergent computation of the output cost (`packages/wallet-core/src/native-onchain.ts:190`, `packages/wallet-core/src/native-onchain.ts:213`, `packages/wallet-core/src/native-onchain.ts:249`) | Same | **Same** |
| Satora rail / Boltz fallback | Satora alone on mainnet, Satora then Boltz as a composite on Mutinynet (`packages/wallet-core/src/arkade-backend.ts:505`) | Same rule (`packages/wallet-core/src/arkade-web-backend.ts:345`) | **Same**. The composite routes to the primary whenever it can serve the request (`packages/wallet-core/src/composite-payment-rail.ts:27`). |
| Receive | Native copy and system share | Browser clipboard, Share button hidden (`apps/wallet-mobile/app/receive.tsx:311`, `apps/wallet-mobile/app/receive.tsx:456`) | **Intended difference** |
| Coin control | Same selection, freeze/unfreeze, renewal, recovery and emergency exit (`apps/wallet-mobile/app/coin-control.tsx:97`) | Same | **Same** |
| Address archives | Same list, labels and restore (`apps/wallet-mobile/app/address-archives.tsx:36`) | Same | **Same** |
| Backup | PIN/biometrics and capture blocking | No equivalent API, explicit "browser wallet" warning (`apps/wallet-mobile/app/backup.tsx:47`, `apps/wallet-mobile/app/backup.tsx:154`) | **Intended difference**. Word-by-word masking and verification are common (`apps/wallet-mobile/app/backup.tsx:88`, `apps/wallet-mobile/app/backup.tsx:208`). |
| Reset | UI pre-check of the swaps and a re-check in the core just before erasing (`apps/wallet-mobile/app/reset-wallet.tsx:43`, `packages/wallet-core/src/ark.ts:483`) | Same | **Same** |

A note on MAX: MAX fills in the Arkade balance before fees. A destination that requires fees can then be refused at quote time. The behaviour is identical on Android and PWA. This is a usability question, not a parity defect between surfaces.

## 8. Public vocabulary

The site is the reference: the groups are "Alice App" and "Alice Wallet", with "Web app" for the App and "Web wallet" for the Wallet (`apps/site/src/components/AppCtas.tsx:35`, `apps/site/src/components/AppCtas.tsx:42`, `apps/site/src/components/AppCtas.tsx:61`). The Playground is described as the App's Mutinynet environment (`apps/site/src/components/Faq.tsx:22`).

Results:

- The Wallet PWA's Local AI message now says "web wallet" and points to the "Alice Wallet app" (`apps/wallet-mobile/app/index.tsx:54`).
- "Playground" remains the public name of the Mutinynet practice environment.
- The internal prefix `alice.test-wallet.*` is deliberately left unchanged to preserve existing data (`apps/app-web/src/lib/playground.ts:32`).
- The current visible key is `alice.playground.ask-open`, with the historical key still read for migration (`apps/app-web/src/components/PlaygroundPanel.tsx:2036`).

Classification: **same after fix**. No public text with an em dash was added.

## Decisions closed before 0.2.0

### 1. Expose the semantic control on Android

Classification: **same after fix**. The medium-severity accidental gap is closed.

The native runtime exposes `getSemanticSearchState`, `downloadSemanticSearchNow` and `disableSemanticSearch` (`packages/alice-ai/src/semantic-runtime.native.ts:337`), and the automatic download only starts over Wi-Fi (`packages/alice-ai/src/semantic-runtime.native.ts:276`). The Android section now renders that state, the manual trigger and the deletion (`apps/wallet-mobile/app/ai-settings.tsx:522`).

The fix was applied in `apps/wallet-mobile/app/ai-settings.tsx`, with no dead section or button in the Expo PWA, which does not have the semantic engine. Android announces the exact native size of 132 MB and reminds the user that Alice keeps answering with keyword search without that model.

Decisions taken:

- The download stays limited to Wi-Fi. Off Wi-Fi the action is disabled and the reason is shown, rather than offering a button that does nothing.
- Since the native runtime provides no percentage, the interface shows an activity indicator and a status line, not a bar frozen at 0 %.
- Deleting or cancelling erases the model and its partial file, then records the `off` choice. A following question therefore does not restart the download, which becomes possible again only through the explicit action in settings, as on the web.

### 2. Perform the coordinated version bump

Classification: **fixed**, common to all 4 surfaces.

The bump stays atomic across the shared number, Expo/EAS, Tauri, Cargo and the Worker constant. The automatic check also covers the lockfiles, the environment examples, the in-app notes and the changelog. The 4 surfaces still have to be built in order to verify that `currentAppVersion()` is `0.2.0` in the distributed artefacts.

## Checks run

- `npm ci` with Node 24.18.0.
- `npm test` with Node 24.18.0: 131/131 test files completed, 0 failures in the isolated tree of the audited branch.
- `npm run check:npm-audit`: 23 high advisories in the accepted baseline, 0 critical.
- `npx tsc --noEmit -p packages/alice-ai`: passed.
- `npx tsc --noEmit -p apps/wallet-mobile`: passed.
- `npm --prefix apps/wallet-mobile run check:ai-boundary`: passed.
- `packages/alice-ai/src/rag-retrieval.integration.test.ts` confirms the exact parity of the web and native indexes.

The audit is mostly static and reinforced by the tests. Actually opening the 4 distributed artefacts, following external links from a signed binary, and the final value injected by each build pipeline all remain to be verified during the release.
