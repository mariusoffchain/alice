# Audit de parité des surfaces Alice pour 0.2.0

Date de l'audit : 2026-08-21
Branche : `app/parity-audit-0.2.0`
Périmètre : Alice App web, Alice App desktop, Alice Wallet Android, Alice Wallet PWA

## Résultat exécutif

La parité fonctionnelle est solide parce que les surfaces sont partagées par paire :

- App web et App desktop exécutent le même frontend Next exporté. Le desktop ajoute les capacités Tauri (`apps/app-desktop/src-tauri/tauri.conf.json:7`).
- Wallet Android et Wallet PWA exécutent les mêmes routes Expo. Les branches `Platform.OS` restent limitées aux capacités de la plateforme, notamment l'authentification locale, la capture d'écran, le presse-papiers et le partage (`apps/wallet-mobile/app/backup.tsx:31`, `apps/wallet-mobile/app/backup.tsx:51`, `apps/wallet-mobile/app/receive.tsx:311`, `apps/wallet-mobile/app/receive.tsx:456`).
- Les 4 surfaces utilisent le même `AccountProvider` et le même `ChatProvider` (`apps/app-web/src/lib/chat-provider.tsx:48`, `apps/wallet-mobile/app/_layout.tsx:170`).

L'audit a trouvé 1 écart accidentel, désormais corrigé : Android possédait le moteur de recherche sémantique natif, mais aucun contrôle correspondant dans ses réglages. Il a aussi trouvé 1 point bloquant de release, commun aux surfaces plutôt qu'un défaut de parité : le serveur annonçait `0.2.0`, alors que plusieurs manifestes clients étaient encore à `0.1.0`. Le bump coordonné et son contrôle automatique sont maintenant appliqués.

Les petits écarts certains ont été corrigés dans des commits séparés :

- `7c6907d` fait ouvrir au desktop la page de release depuis la bannière de mise à jour.
- `717143e` aligne les rappels e-mail du Wallet sur la règle et le texte de l'App.
- `6a4e00f` retire du Wallet les restes visuels de l'ancien bouton Deep et rétablit le vocabulaire « web wallet » / « Alice Wallet app ».
- `d7b763e` supprime la promesse résiduelle du bouton cerveau dans les réglages App.
- `8f97f4a` couvre explicitement Local, Private Cloud et custom dans le test de mémoire.
- `565b909` donne au build PWA une version d'application par défaut.
- `6d186b0` fait passer `fast-uri` de 3.1.2 à 3.1.5 après la publication d'un nouvel avis de la même famille pendant l'audit. La chaîne reste limitée à `expo-build-properties` → `ajv` → `fast-uri`, mais la version corrigée est maintenant compatible avec la contrainte existante.

## Légende

- **Identique** : même moteur ou même comportement observable.
- **Différence voulue** : différence justifiée par le produit ou une capacité de plateforme.
- **Différence accidentelle** : divergence sans contrainte de plateforme ou contrat produit correspondant.
- **Non vérifié dynamiquement** : conclusion issue du code et des tests, sans exécution des 4 binaires distribués.

## 1. Chat et contexte IA

| Contrat | App web | App desktop | Wallet Android | Wallet PWA | Verdict |
| --- | --- | --- | --- | --- | --- |
| Envoi, streaming, édition, régénération, historique | `ChatProvider` partagé (`packages/alice-ai/src/chat-context.tsx:253`, `packages/alice-ai/src/chat-context.tsx:530`) | Même frontend et même provider | Même provider | Même provider | **Identique** |
| Backend initial et choix sauvegardé | Private Cloud par défaut, choix sauvegardé (`packages/alice-ai/src/chat-context.tsx:264`, `packages/alice-ai/src/chat-context.tsx:303`) | Peut préférer Local quand Tauri le rend disponible (`packages/alice-ai/src/chat-context.tsx:318`) | Private Cloud par défaut | Private Cloud par défaut, Local indisponible | **Différence voulue** |
| Langue de réponse | Résolution commune avant génération (`packages/alice-ai/src/chat-context.tsx:579`) | Identique | Identique | Identique | **Identique** |
| Instructions personnalisées | Injectées par le coeur partagé (`packages/alice-ai/src/chat-context.tsx:637`) | Identique | Identique | Identique | **Identique** |
| Mémoire personnelle | Injectée dans l'historique génératif (`packages/alice-ai/src/turn-engine.ts:122`, `packages/alice-ai/src/generation-context.ts:81`) | Identique | Identique | Identique | **Identique**. Le test couvre Local, Private Cloud et custom (`packages/alice-ai/src/turn-engine.test.ts:95`). |
| Suggestions de départ | 4 cartes (`apps/app-web/src/components/ChatPanel.tsx:27`, `apps/app-web/src/components/ChatPanel.tsx:226`) | Identique | Absentes | Absentes | **Différence voulue, inférée**. Elles appartiennent à l'accueil éditorial de l'App, pas au compositeur compact du Wallet. |
| « To go further » | Ponts Learn, Explorer et Playground (`apps/app-web/src/components/ChatPanel.tsx:102`, `apps/app-web/src/components/ChatPanel.tsx:259`) | Identique | Absent | Absent | **Différence voulue**. Les destinations n'existent pas dans le Wallet. |
| Bouton cerveau / Deep par message | Absent | Absent | Absent | Absent | **Identique**. La fonctionnalité a été retirée. Le preset `High` reste un budget de raisonnement, pas un autre modèle (`packages/alice-ai/src/ai-preferences.ts:112`). Les textes et badges fantômes ont été supprimés. |

Conclusion : le moteur conversationnel est commun aux 4 surfaces. Les différences restantes sont des choix de composition entre l'App éducative et le Wallet.

## 2. Comptes Alice

| Contrat | App web | App desktop | Wallet Android | Wallet PWA | Verdict |
| --- | --- | --- | --- | --- | --- |
| Création, code e-mail, connexion par mot de passe, récupération | Dialogue web branché sur le provider partagé (`apps/app-web/src/components/AccountPasswordDialog.tsx:13`, `apps/app-web/src/components/AccountPasswordDialog.tsx:435`) | Identique | Modal native branchée sur le même provider (`apps/wallet-mobile/components/AccountPasswordModal.tsx:23`, `apps/wallet-mobile/components/AccountPasswordModal.tsx:308`) | Même modal Expo | **Identique fonctionnellement** |
| Changement de nom, identités et suppression | Actions du provider commun (`packages/alice-ai/src/account-context.tsx:407`, `packages/alice-ai/src/account-context.tsx:421`, `packages/alice-ai/src/account-context.tsx:457`) | Identique | Identique | Identique | **Identique** |
| Plan et quotas | Plan, échéance, jauge et quota gratuit (`apps/app-web/src/components/settings/AccountTab.tsx:153`) | Identique | Même état `cloudUsage` et même distinction free/paid (`apps/wallet-mobile/app/account.tsx:75`) | Identique | **Identique** |
| Achat et renouvellement | Checkout BTCPay dans l'App (`apps/app-web/src/components/settings/PlanCheckout.tsx:63`) | Même flow web | Renvoi vers l'App web (`apps/wallet-mobile/app/account.tsx:194`) | Même renvoi | **Différence voulue**. Le Wallet ne vend pas le plan et conserve un seul flow de paiement. |
| Rappels d'expiration | Information sans interrupteur trompeur (`apps/app-web/src/components/settings/RenewalReminders.tsx:13`, `apps/app-web/src/components/settings/RenewalReminders.tsx:34`) | Identique | Texte et absence d'interrupteur désormais alignés (`apps/wallet-mobile/app/account.tsx:219`) | Identique | **Identique après correction** |
| Confirmation de paiement | Écran et attente dans le flow App | Identique | Retour visible après rafraîchissement du compte | Identique | **Différence voulue** car le checkout vit dans l'App. |

La logique de compte et de quota n'est pas dupliquée. Les deux dialogues sont des présentations distinctes du même `AccountProvider` (`packages/alice-ai/src/account-context.tsx:93`).

## 3. Réglages et modèles

| Contrat | App web | App desktop | Wallet Android | Wallet PWA | Verdict |
| --- | --- | --- | --- | --- | --- |
| Sections principales | General, Appearance, AI, Account, Explorer, Data (`apps/app-web/src/components/settings/tabs.tsx:74`) | Identique | Account, Appearance, Customize Alice, App Lock, Advanced, About, Support (`apps/wallet-mobile/lib/settings-sections.ts:28`) | Identique | **Différence voulue** selon le produit. |
| Réglages Wallet avancés | Absents | Absents | Logs, serveur, coin control, adresses, renouvellement, swaps et sortie (`apps/wallet-mobile/lib/advanced-sections.ts:28`) | Identiques quand le backend web le permet | **Différence voulue** |
| Local AI | Message honnête dans le navigateur (`apps/app-web/src/components/settings/AiTab.tsx:141`) | Catalogue local | Téléchargement et gestion des modèles (`apps/wallet-mobile/app/ai-settings.tsx:342`) | Message d'installation de l'Alice Wallet app (`apps/wallet-mobile/app/ai-settings.tsx:568`) | **Différence voulue** |
| Private Cloud | Activation commune | Identique | Activation commune (`apps/wallet-mobile/app/ai-settings.tsx:225`) | Identique | **Identique** |
| Serveur custom | URL, modèle et clé (`apps/app-web/src/components/settings/AiTab.tsx:275`) | Identique | Même triplet et connexion (`apps/wallet-mobile/app/ai-settings.tsx:577`) | Identique | **Identique** |
| Mémoire | Lecture et effacement de la mémoire et du profil (`apps/app-web/src/components/settings/AliceMemoryPanel.tsx:58`, `apps/app-web/src/components/settings/AliceMemoryPanel.tsx:80`) | Identique | Même contrôle (`apps/wallet-mobile/app/what-alice-knows.tsx:67`) | Identique | **Identique** |
| Instructions | Sauvegarde et effacement (`apps/app-web/src/components/settings/AiTab.tsx:189`) | Identique | Même contrat, annoncé pour cloud, local et custom (`apps/wallet-mobile/app/ai-settings.tsx:298`) | Identique | **Identique** |
| Langue | Réglage partagé par la même clé | Identique | UI dans Customize Alice (`apps/wallet-mobile/app/ai-settings.tsx:265`) | Identique | **Identique**, emplacement différent. |
| Recherche sémantique | Téléchargement, progression, arrêt et suppression (`apps/app-web/src/components/settings/SemanticSearchSection.tsx:43`) | Modèle inclus, bouton de chargement (`apps/app-web/src/components/settings/SemanticSearchSection.tsx:57`) | Moteur actif mais aucun contrôle dans `ai-settings.tsx` | Moteur explicitement non supporté | **Différence accidentelle sur Android**, voir décisions ouvertes. PWA est une différence voulue. |

Les textes présents décrivent correctement les capacités de leur surface après retrait de la promesse résiduelle du bouton cerveau. Les promesses de confidentialité existantes n'ont pas été modifiées.

## 4. Stockage local

### Clés logiques

| Domaine | Clés | App web / desktop | Wallet Android / PWA | Verdict |
| --- | --- | --- | --- | --- |
| Conversations | `alice_chat_sessions`, `alice_chat_session_*` (`packages/alice-ai/src/chat-storage.ts:4`) | AsyncStorage web | AsyncStorage Expo | **Identique** |
| Mémoire personnelle | `alice_personal_memory_v1` (`packages/alice-ai/src/alice-memory-storage.ts:4`, `packages/alice-ai/src/alice-memory-storage.native.ts:4`) | localStorage | SecureStore Android, stockage navigateur PWA | **Identique logiquement** |
| Profil pédagogique | `alice_learning_profile_v3`, migration `alice_pedagogical_profile_v1` (`packages/alice-ai/src/pedagogical-profile-storage.ts:3`, `packages/alice-ai/src/pedagogical-profile-storage.native.ts:4`) | localStorage | SecureStore Android, stockage navigateur PWA | **Identique logiquement** |
| Session de compte | `alice_account_session_v1`, `alice_install_id_v1`, `alice_pending_checkout_v1` (`packages/alice-ai/src/account-client.ts:14`) | AsyncStorage web | SecureStore Android, AsyncStorage web PWA (`packages/alice-ai/src/account-session-storage.native.ts:3`) | **Identique logiquement**, protection adaptée à la plateforme. |
| Préférences IA | presets, modèles, instructions, langue, activation, backends, serveur custom (`packages/alice-ai/src/ai-preferences.ts:121`, `packages/alice-ai/src/ai-preferences.ts:315`, `packages/alice-ai/src/ai-preferences.ts:379`) | AsyncStorage web | AsyncStorage Expo | **Identique** |
| Thème | `alice_theme_mode`, `alice_palette` (`apps/app-web/src/lib/theme-init.ts:6`, `packages/alice-ui/src/theme-context.tsx:5`) | localStorage | AsyncStorage | **Identique logiquement** |

### Protection au repos

- Desktop chiffre les conversations, l'index, la mémoire personnelle et le profil pédagogique via Tauri. La migration vérifie chaque chiffrement avant remplacement (`packages/alice-ai/src/chat-storage.ts:54`, `packages/alice-ai/src/chat-storage.ts:111`).
- Android protège mémoire, profil et session de compte avec SecureStore. L'historique de chat reste en AsyncStorage sans `ChatStorageCipher` (`apps/wallet-mobile/app/_layout.tsx:171`).
- Les 2 surfaces navigateur stockent localement sans chiffrement applicatif.

Cette différence est **voulue et documentée pour 0.2.0**, pas un drift silencieux. La documentation dit explicitement que le chiffrement des conversations est implémenté sur Desktop et que les adaptateurs Wallet restent à faire (`docs/security/local-chat-encryption.md:3`, `docs/wallet-data-and-recovery.md:30`). Aucun renommage de clé n'est nécessaire.

## 5. Learn, RAG et recherche sémantique

| Contrat | App web | App desktop | Wallet Android | Wallet PWA | Verdict |
| --- | --- | --- | --- | --- | --- |
| RAG lexical coeur | Pack partagé | Pack partagé | Pack partagé | Pack partagé | **Identique** |
| Contexte Learn | Provider enregistré par l'App (`apps/app-web/src/lib/chat-provider.tsx:31`) | Identique | Aucun provider | Aucun provider | **Différence voulue**. Une surface sans Learn renvoie `null` sans modifier la réponse (`packages/alice-ai/src/learn-context.ts:31`). |
| Tolérance de Learn | Limite de 1,5 s et échec neutre (`packages/alice-ai/src/learn-context.ts:17`) | Identique | Sans objet | Sans objet | **Identique pour les surfaces concernées** |
| Index sémantique | Index public + modèle navigateur à la 1re question (`packages/alice-ai/src/semantic-runtime-browser.ts:1`) | Index et modèle embarqués | Index embarqué + modèle téléchargé seulement en Wi-Fi (`packages/alice-ai/src/semantic-runtime.native.ts:81`, `packages/alice-ai/src/semantic-runtime.native.ts:128`) | Stub lexical neutre à cause de Metro (`packages/alice-ai/src/semantic-runtime.web.ts:4`) | **Différence voulue**, sauf l'UI Android manquante. |
| Parité du corpus | Vérifiée entre index web et natif, y compris identifiants, hash et dimensions (`packages/alice-ai/src/rag-retrieval.integration.test.ts:59`) | Identique | Identique | RAG lexical commun | **Identique** |
| Fallback | Lexical pendant chargement ou erreur | Identique | Lexical tant que modèle absent | Toujours lexical | **Identique dans le principe**, capacité différente. |

Les artefacts RAG générés n'ont pas été régénérés ni modifiés, conformément au périmètre.

## 6. Notifications de mise à jour

Le coeur est partagé. Il utilise les mêmes clés, limite les requêtes à 1 toutes les 6 h, échoue silencieusement et n'affiche pas « What's new » à la première installation (`packages/alice-ai/src/app-update.ts:18`, `packages/alice-ai/src/app-update.ts:48`, `packages/alice-ai/src/app-update.ts:71`).

| Surface | Action lorsqu'une version plus récente existe | « What's new » | Verdict |
| --- | --- | --- | --- |
| App web | Recharge la page (`apps/app-web/src/components/AppUpdateNotices.tsx:95`) | 1 fois par version | **Identique au contrat** |
| App desktop | Ouvre la page de release (`apps/app-web/src/components/AppUpdateNotices.tsx:79`) | 1 fois par version | **Corrigé** |
| Wallet Android | Ouvre la page de release (`apps/wallet-mobile/components/AppUpdateNotices.tsx:46`) | 1 fois par version | **Identique au contrat** |
| Wallet PWA | Recharge la page (`apps/wallet-mobile/components/AppUpdateNotices.tsx:47`) | 1 fois par version | **Corrigé**. Le build renseigne désormais la version depuis `app.json` si aucune variable n'est fournie (`apps/wallet-mobile/scripts/build-pwa.js:28`). |

Les 2 composants donnent la priorité à « What's new » et n'affichent qu'une annonce à la fois (`apps/app-web/src/components/AppUpdateNotices.tsx:63`, `apps/wallet-mobile/components/AppUpdateNotices.tsx:56`).

### Point bloquant de release, corrigé

Le Worker renvoyait déjà `0.2.0`, alors que le monorepo, Expo, EAS production et Tauri déclaraient encore `0.1.0`. Une build 0.2.0 se serait donc présentée elle-même comme 0.1.0 et aurait immédiatement vu une mise à jour 0.2.0.

Classification : **étape de release commune, corrigée avant distribution**, pas une divergence entre surfaces. Le numéro est maintenant `0.2.0` dans les manifestes applicatifs, le crate et lockfile Cargo, EAS, les exemples d'environnement, la constante Worker, le changelog et les notes intégrées. `scripts/check-release-version.mjs` refuse désormais toute divergence et s'exécute au début de `npm test`.

## 7. Wallet Android et PWA

Les écrans send, receive, coin control, archives, backup et reset sont les mêmes fichiers Expo. Les branches observées correspondent à des capacités de plateforme.

| Fonction | Android | PWA | Verdict |
| --- | --- | --- | --- |
| MAX | Relit le solde off-chain disponible et refuse les fonds gelés (`apps/wallet-mobile/app/send.tsx:257`) | Identique | **Identique** |
| Validation et confirmation | Même parsing, mêmes contrôles de réseau et mêmes montants quote/frais/total (`apps/wallet-mobile/app/send.tsx:369`, `apps/wallet-mobile/app/send.tsx:802`) | Identique | **Identique** |
| Sortie native mainnet avec Satora | Utilisée quand réseau Bitcoin + Satora (`apps/wallet-mobile/app/send.tsx:409`) | Identique | **Identique** |
| Frais par entrée et sortie | Somme des frais d'entrée et calcul convergent du coût de sortie (`packages/wallet-core/src/native-onchain.ts:190`, `packages/wallet-core/src/native-onchain.ts:213`, `packages/wallet-core/src/native-onchain.ts:249`) | Identique | **Identique** |
| Rail Satora / fallback Boltz | Satora seul sur mainnet, composite Satora puis Boltz sur Mutinynet (`packages/wallet-core/src/arkade-backend.ts:505`) | Même règle (`packages/wallet-core/src/arkade-web-backend.ts:345`) | **Identique**. Le composite route vers le primaire quand il sait traiter la demande (`packages/wallet-core/src/composite-payment-rail.ts:27`). |
| Receive | Copie native et partage système | Clipboard navigateur, bouton Share masqué (`apps/wallet-mobile/app/receive.tsx:311`, `apps/wallet-mobile/app/receive.tsx:456`) | **Différence voulue** |
| Coin control | Même sélection, freeze/unfreeze, renewal, recovery et emergency exit (`apps/wallet-mobile/app/coin-control.tsx:97`) | Identique | **Identique** |
| Archives d'adresses | Même liste, libellés et restauration (`apps/wallet-mobile/app/address-archives.tsx:36`) | Identique | **Identique** |
| Backup | PIN/biométrie et blocage de capture | Pas d'API équivalente, avertissement explicite « browser wallet » (`apps/wallet-mobile/app/backup.tsx:47`, `apps/wallet-mobile/app/backup.tsx:154`) | **Différence voulue**. Masquage mot par mot et vérification sont communs (`apps/wallet-mobile/app/backup.tsx:88`, `apps/wallet-mobile/app/backup.tsx:208`). |
| Reset | Précontrôle UI des swaps et recontrôle dans le coeur juste avant effacement (`apps/wallet-mobile/app/reset-wallet.tsx:43`, `packages/wallet-core/src/ark.ts:483`) | Identique | **Identique** |

Note MAX : MAX remplit le solde Arkade avant frais. Une destination qui exige des frais peut ensuite être refusée au moment du devis. Le comportement est identique sur Android et PWA. C'est une question d'ergonomie fonctionnelle, pas un défaut de parité entre surfaces.

## 8. Vocabulaire public

Le site sert de référence : les groupes sont « Alice App » et « Alice Wallet », avec « Web app » pour l'App et « Web wallet » pour le Wallet (`apps/site/src/components/AppCtas.tsx:35`, `apps/site/src/components/AppCtas.tsx:42`, `apps/site/src/components/AppCtas.tsx:61`). Le Playground est décrit comme l'environnement Mutinynet de l'App (`apps/site/src/components/Faq.tsx:22`).

Résultats :

- Le message Local AI du Wallet PWA dit désormais « web wallet » et renvoie vers « Alice Wallet app » (`apps/wallet-mobile/app/index.tsx:54`).
- « Playground » reste le nom public de la pratique Mutinynet.
- Le préfixe interne `alice.test-wallet.*` reste volontairement inchangé pour préserver les données existantes (`apps/app-web/src/lib/playground.ts:32`).
- La clé visible actuelle est `alice.playground.ask-open`, avec lecture de la clé historique pour migration (`apps/app-web/src/components/PlaygroundPanel.tsx:2036`).

Classification : **identique après correction**. Aucun texte public avec tiret cadratin n'a été ajouté.

## Décisions closes avant 0.2.0

### 1. Exposer le contrôle sémantique sur Android

Classification : **identique après correction**. L'écart accidentel de sévérité moyenne est fermé.

Le runtime natif expose `getSemanticSearchState`, `downloadSemanticSearchNow` et `disableSemanticSearch` (`packages/alice-ai/src/semantic-runtime.native.ts:337`), et le téléchargement automatique ne démarre qu'en Wi-Fi (`packages/alice-ai/src/semantic-runtime.native.ts:276`). La section Android rend désormais cet état, le déclenchement manuel et la suppression (`apps/wallet-mobile/app/ai-settings.tsx:522`).

Correction appliquée dans `apps/wallet-mobile/app/ai-settings.tsx`, sans section ni bouton mort dans la PWA Expo qui ne possède pas le moteur sémantique. Android annonce la taille native exacte de 132 MB et rappelle qu'Alice continue de répondre avec la recherche par mots-clés sans ce modèle.

Décisions prises :

- Le téléchargement reste limité au Wi-Fi. Hors Wi-Fi, l'action est désactivée et la raison est affichée au lieu de proposer un bouton sans effet.
- Le runtime natif ne fournissant aucun pourcentage, l'interface montre un indicateur d'activité et un texte d'état, sans barre figée à 0 %.
- Supprimer ou annuler efface le modèle et son fichier partiel, puis enregistre le choix `off`. Une question suivante ne relance donc pas le téléchargement, qui ne redevient possible que par l'action explicite des réglages, comme sur le web.

### 2. Effectuer le bump de version coordonné

Classification : **corrigé**, commun aux 4 surfaces.

Le bump reste atomique entre le numéro partagé, Expo/EAS, Tauri, Cargo et la constante Worker. Le contrôle automatique vérifie aussi les lockfiles, exemples d'environnement, notes intégrées et changelog. Les 4 surfaces doivent encore être construites afin de vérifier que `currentAppVersion()` vaut `0.2.0` dans les artefacts distribués.

## Vérifications exécutées

- `npm ci` avec Node 24.18.0.
- `npm test` avec Node 24.18.0 : 131/131 fichiers de test terminés, 0 échec dans l'arbre isolé de la branche auditée.
- `npm run check:npm-audit` : 23 alertes hautes dans la baseline acceptée, 0 critique.
- `npx tsc --noEmit -p packages/alice-ai` : réussi.
- `npx tsc --noEmit -p apps/wallet-mobile` : réussi.
- `npm --prefix apps/wallet-mobile run check:ai-boundary` : réussi.
- `packages/alice-ai/src/rag-retrieval.integration.test.ts` confirme la parité exacte des index web et natif.

L'audit est principalement statique et renforcé par les tests. L'ouverture réelle des 4 artefacts distribués, les liens externes depuis un binaire signé et la valeur finale injectée par chaque pipeline de build restent à vérifier pendant la release.
