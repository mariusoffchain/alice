// Answer rules: the points a retrieved note makes mandatory, and the claims
// it rules out. The measured models (Qwen3.5 9B on 2026-10-06, the Private
// Cloud model the same day) kept inverting three subjects with the right
// note in front of them: an Ark exit presented as depending on the operator,
// a multisig quorum inflated to "all three signatures", a replacement made
// conditional on an opt-in flag. Two deterministic layers answer that
// without replacing generation by canned text:
//
// 1. When one of these notes is in the retrieved context of a turn, a short
//    instruction block built from its rules rides with the context
//    (generation-context.ts). It is bounded so it always fits the local
//    context budget next to the notes themselves.
// 2. After generation, each sentence of the answer is tested against the
//    never-claim patterns of the notes that were in context. A match appends
//    a short correction in the user's language, in the spirit of the
//    live-value caveat (live-value-caveat.ts). The answer is never rewritten
//    or blocked, and the match is reported in the generation diagnostics.
//
// The rules are keyed by note id and kept out of the knowledge packs: they
// are instructions for the model and for the output guard, not retrievable
// text, so they change neither the pack schema nor the corpus hash.

import type { SupportedLanguage } from './language-policy.ts';

type Localized = Record<SupportedLanguage, string>;

export type AnswerRule = {
  noteId: string;
  /** The title the retrieval formats as "Topic: <title>" (rag.ts). */
  title: string;
  mustState: Record<SupportedLanguage, readonly string[]>;
  neverClaim: Record<SupportedLanguage, readonly string[]>;
};

export type ClaimPattern = {
  /** Tested on each normalized sentence of the answer. */
  test: RegExp;
  /** A sentence that also matches this states something else. */
  unless?: RegExp;
};

export type NeverClaimCheck = {
  id: string;
  /** Active only when one of these notes was in the retrieved context. */
  notes: readonly string[];
  /** Any matching pattern counts. */
  patterns: readonly ClaimPattern[];
  /**
   * Denial or hedge words. Tested on the whole sentence, or, with the
   * 'span' scope, on the matched claim and a short margin around it, so
   * a negation elsewhere in a long French sentence does not hide the claim.
   */
  unless?: RegExp;
  unlessScope?: 'sentence' | 'span';
  /**
   * Tested on the whole sentence whatever the scope of `unless`: a question,
   * a quoted claim or a refutation ("a common myth", "ce qui est faux")
   * repeats the claim without making it.
   */
  unlessSentence?: RegExp;
  /** Skipped when the user's own question matches, e.g. a threshold the user stated. */
  unlessQuestion?: RegExp;
  correction: Localized;
};

/** Longest instruction block, in characters, including its header. */
export const ANSWER_RULES_MAX_CHARS = 1700;

// Sentences shared by two notes are the same string, so a turn that retrieves
// both notes states them once.
const EXIT_WITHOUT_OPERATOR: Localized = {
  en: 'A vTXO holder can start a unilateral exit without the operator, from the exit data the wallet keeps; the operator cannot block, refuse or confiscate it.',
  fr: "Le détenteur d'un vTXO peut lancer une sortie unilatérale sans l'opérateur, à partir des données de sortie que le portefeuille conserve ; l'opérateur ne peut ni la bloquer, ni la refuser, ni confisquer les fonds.",
};
const EXIT_MECHANICS: Localized = {
  en: 'The exit publishes on-chain transactions, pays fees and waits for confirmations and timelocks before the coins are spendable; it is slower and costlier than a cooperative exit, not impossible.',
  fr: "La sortie publie des transactions sur la chaîne, paie des frais et attend les confirmations et les délais (timelocks) avant que les bitcoins soient dépensables ; elle est plus lente et plus coûteuse qu'une sortie coopérative, pas impossible.",
};
const EXPIRY_RULE: Localized = {
  en: 'A vTXO must be refreshed or exited before its expiry; past that deadline its value returns to the operator. Exact rules and timings depend on the wallet and server version, so point to the wallet rather than to a universal rule.',
  fr: "Un vTXO doit être rafraîchi ou sorti avant son expiration ; passé ce délai, sa valeur revient à l'opérateur. Les règles et délais exacts dépendent du portefeuille et de la version du serveur : renvoie au portefeuille plutôt qu'à une règle universelle.",
};
const OPERATOR_POWERS: Localized = {
  en: 'The operator cannot move funds without the user\'s signature; what it can do is stop cooperating, which slows exits and makes them costlier, and see the activity it coordinates.',
  fr: "L'opérateur ne peut pas déplacer les fonds sans la signature de l'utilisateur ; ce qu'il peut faire, c'est cesser de coopérer, ce qui ralentit et renchérit les sorties, et voir l'activité qu'il coordonne.",
};
const NO_OPERATOR_BLOCK: Localized = {
  en: 'that the operator can block, refuse, lock or delay a unilateral exit, or that the user is stuck when it disappears',
  fr: "que l'opérateur peut bloquer, refuser, verrouiller ou retarder une sortie unilatérale, ou que l'utilisateur reste coincé s'il disparaît",
};
const NO_FUNDS_LOST: Localized = {
  en: 'that the funds are lost or confiscated when the operator disappears',
  fr: "que les fonds sont perdus ou confisqués quand l'opérateur disparaît",
};
const NO_EXPIRY_INVERSION: Localized = {
  en: 'that a vTXO becomes recoverable or spendable after its expiry',
  fr: "qu'un vTXO devient récupérable ou dépensable après son expiration",
};
const NO_INSTANT_EXIT: Localized = {
  en: 'that exits are instant, free or identical across implementations',
  fr: 'que les sorties sont instantanées, gratuites ou identiques partout',
};

const CONFIRMED_IS_FINAL: Localized = {
  en: 'A confirmed payment cannot be undone or replaced; treat it as final.',
  fr: 'Un paiement confirmé ne peut être ni annulé ni remplacé ; considère-le comme définitif.',
};
const REPLACEMENT_CONDITIONS: Localized = {
  en: 'While unconfirmed, a replacement that spends the same inputs and pays a higher fee may be possible, if the wallet supports it and node policies accept it; it is never guaranteed.',
  fr: "Tant qu'il n'est pas confirmé, un remplacement qui dépense les mêmes entrées avec des frais plus élevés peut être possible, si le portefeuille le permet et si les politiques des nœuds l'acceptent ; ce n'est jamais garanti.",
};
const FULL_RBF: Localized = {
  en: 'Opt-in signaling (BIP 125) is not a precondition everywhere: nodes and miners applying full-RBF, the Bitcoin Core default since version 28.0, also accept a replacement of a transaction that did not signal it.',
  fr: "Le signal opt-in (BIP 125) n'est pas une condition partout : les nœuds et mineurs qui appliquent le full-RBF, comportement par défaut de Bitcoin Core depuis la version 28.0, acceptent aussi le remplacement d'une transaction qui ne l'a pas signalé.",
};
const NO_SECOND_PAYMENT: Localized = {
  en: 'Never send a second independent payment as a remedy; verify destination, amount and total fee in the wallet before any replacement.',
  fr: "N'envoie jamais un second paiement indépendant pour corriger le premier ; vérifie la destination, le montant et les frais totaux dans le portefeuille avant tout remplacement.",
};
const NO_OPT_IN_PRECONDITION: Localized = {
  en: 'that a replacement works only if RBF was enabled or signaled when the payment was sent',
  fr: "qu'un remplacement ne fonctionne que si l'option RBF a été activée ou signalée à l'envoi",
};
const NO_SECOND_PAYMENT_REMEDY: Localized = {
  en: 'that a second payment, or a new transaction with other inputs, fixes or speeds up the first one',
  fr: "qu'un second paiement, ou une nouvelle transaction avec d'autres entrées, corrige ou accélère le premier",
};
const NO_REVERSAL: Localized = {
  en: 'that a confirmed payment can be reversed, or that Alice cancelled or replaced a real transaction',
  fr: "qu'un paiement confirmé peut être annulé, ou qu'Alice a annulé ou remplacé une transaction réelle",
};

export const ANSWER_RULES: readonly AnswerRule[] = [
  {
    noteId: 'ark-rounds-exits',
    title: 'Ark rounds and exits',
    mustState: {
      en: [EXIT_WITHOUT_OPERATOR.en, EXIT_MECHANICS.en, EXPIRY_RULE.en],
      fr: [EXIT_WITHOUT_OPERATOR.fr, EXIT_MECHANICS.fr, EXPIRY_RULE.fr],
    },
    neverClaim: {
      en: [NO_OPERATOR_BLOCK.en, NO_FUNDS_LOST.en, NO_EXPIRY_INVERSION.en, NO_INSTANT_EXIT.en],
      fr: [NO_OPERATOR_BLOCK.fr, NO_FUNDS_LOST.fr, NO_EXPIRY_INVERSION.fr, NO_INSTANT_EXIT.fr],
    },
  },
  {
    noteId: 'asp-operator',
    title: 'Ark operator / ASP',
    mustState: {
      en: [OPERATOR_POWERS.en, EXIT_WITHOUT_OPERATOR.en, EXIT_MECHANICS.en, EXPIRY_RULE.en],
      fr: [OPERATOR_POWERS.fr, EXIT_WITHOUT_OPERATOR.fr, EXIT_MECHANICS.fr, EXPIRY_RULE.fr],
    },
    neverClaim: {
      en: [NO_OPERATOR_BLOCK.en, NO_FUNDS_LOST.en, NO_EXPIRY_INVERSION.en],
      fr: [NO_OPERATOR_BLOCK.fr, NO_FUNDS_LOST.fr, NO_EXPIRY_INVERSION.fr],
    },
  },
  {
    noteId: 'multisig',
    title: 'Bitcoin multisig',
    mustState: {
      en: [
        'An m-of-n wallet signs with any m of its n keys: a 2-of-3 wallet spends with any two of its three keys. Keep the threshold the user states and never assume a higher one.',
        'A quorum of seeds alone may not rebuild the wallet: the complete configuration or descriptor is needed too, with all cosigner public keys, the threshold, the script policy and the derivation paths.',
        'Verify recovery in a safe test with the wallet documentation, without sending seeds or keys to anyone, including a chat or support agent.',
        'Keep the backups of the seeds and of the descriptor in separate failure domains.',
      ],
      fr: [
        "Un portefeuille m de n signe avec m de ses n clés : un 2 de 3 dépense avec deux clés sur trois, quelles qu'elles soient. Garde le seuil indiqué par l'utilisateur et ne suppose jamais un seuil plus élevé.",
        'Un quorum de seeds seul peut ne pas suffire à reconstruire le portefeuille : il faut aussi la configuration complète ou le descripteur, avec les clés publiques de tous les cosignataires, le seuil, la politique de script et les chemins de dérivation.',
        "Vérifie la récupération par un test sûr avec la documentation du portefeuille, sans envoyer de seed ni de clé à qui que ce soit, y compris à un chat ou à un support.",
        'Conserve les sauvegardes des seeds et du descripteur dans des lieux de défaillance séparés.',
      ],
    },
    neverClaim: {
      en: [
        'that a 2-of-3 wallet needs three signatures or the third seed',
        'that the user\'s wallet is 3-of-3, or any threshold the user did not state',
        'that the seeds alone guarantee recovery',
        'that Alice Wallet can import the seeds or rebuild a multisig wallet, or any Alice feature absent from the notes',
      ],
      fr: [
        "qu'un portefeuille 2 de 3 a besoin de trois signatures ou de la troisième seed",
        "que le portefeuille de l'utilisateur est un 3 de 3, ou tout seuil qu'il n'a pas indiqué",
        'que les seeds seules garantissent la récupération',
        "qu'Alice Wallet peut importer les seeds ou reconstruire un portefeuille multisig, ou toute fonction d'Alice absente des notes",
      ],
    },
  },
  {
    noteId: 'replace-by-fee',
    title: 'Replace-by-fee',
    mustState: {
      en: [CONFIRMED_IS_FINAL.en, REPLACEMENT_CONDITIONS.en, FULL_RBF.en, NO_SECOND_PAYMENT.en],
      fr: [CONFIRMED_IS_FINAL.fr, REPLACEMENT_CONDITIONS.fr, FULL_RBF.fr, NO_SECOND_PAYMENT.fr],
    },
    neverClaim: {
      en: [NO_OPT_IN_PRECONDITION.en, NO_SECOND_PAYMENT_REMEDY.en, NO_REVERSAL.en],
      fr: [NO_OPT_IN_PRECONDITION.fr, NO_SECOND_PAYMENT_REMEDY.fr, NO_REVERSAL.fr],
    },
  },
  {
    noteId: 'transaction-finality',
    title: 'Bitcoin finality',
    mustState: {
      en: [CONFIRMED_IS_FINAL.en, REPLACEMENT_CONDITIONS.en, FULL_RBF.en, NO_SECOND_PAYMENT.en],
      fr: [CONFIRMED_IS_FINAL.fr, REPLACEMENT_CONDITIONS.fr, FULL_RBF.fr, NO_SECOND_PAYMENT.fr],
    },
    neverClaim: {
      en: [NO_REVERSAL.en, NO_OPT_IN_PRECONDITION.en, NO_SECOND_PAYMENT_REMEDY.en],
      fr: [NO_REVERSAL.fr, NO_OPT_IN_PRECONDITION.fr, NO_SECOND_PAYMENT_REMEDY.fr],
    },
  },
];

const ARK_NOTES = ['ark-rounds-exits', 'asp-operator'] as const;
const RBF_NOTES = ['replace-by-fee', 'transaction-finality'] as const;

const ARK_EXIT_CORRECTION: Localized = {
  en: 'Correction: the operator cannot block, refuse or delay a unilateral exit, and your funds are not lost if it disappears. Every vTXO is backed by pre-signed exit transactions kept by your wallet: you can publish them on-chain yourself, pay the fees and wait for confirmations and timelocks before the coins are spendable, without any permission from the operator. What the operator can do is stop cooperating, which makes an exit slower and costlier, not impossible. Check the exit and expiry rules of your wallet and server version.',
  fr: "Correction : l'opérateur ne peut ni bloquer, ni refuser, ni retarder une sortie unilatérale, et tes fonds ne sont pas perdus s'il disparaît. Chaque vTXO est adossé à des transactions de sortie pré-signées que ton portefeuille conserve : tu peux les publier toi-même sur la chaîne, payer les frais et attendre les confirmations et les délais (timelocks) avant de pouvoir dépenser les bitcoins, sans aucune permission de l'opérateur. Ce qu'il peut faire, c'est cesser de coopérer, ce qui rend la sortie plus lente et plus coûteuse, pas impossible. Vérifie les règles de sortie et d'expiration de ton portefeuille et de la version du serveur.",
};
const ARK_EXPIRY_CORRECTION: Localized = {
  en: 'Correction: a vTXO does not become recoverable after its expiry. It must be refreshed or exited before that deadline; past it, its value returns to the operator. The exact expiry rules and timings depend on your wallet and server version, so check them in your wallet rather than assuming a universal rule.',
  fr: "Correction : un vTXO ne devient pas récupérable après son expiration. Il doit être rafraîchi ou sorti avant cette échéance ; passé ce délai, sa valeur revient à l'opérateur. Les règles et délais d'expiration exacts dépendent de ton portefeuille et de la version du serveur : vérifie-les dans ton portefeuille plutôt que de supposer une règle universelle.",
};
const MULTISIG_QUORUM_CORRECTION: Localized = {
  en: 'Correction: a multisig wallet spends with its threshold of keys, not with all of them: a 2-of-3 wallet signs with any two of its three keys, and a third signature or seed is not required. Do not assume a higher threshold than the one your wallet was set up with. Two seeds alone may still not rebuild the wallet without its complete configuration or descriptor (all cosigner public keys, threshold, script policy and derivation paths), so check that backup and test the recovery safely, without sending seeds or keys to anyone.',
  fr: "Correction : un portefeuille multisig dépense avec son seuil de clés, pas avec toutes : un 2 de 3 signe avec deux clés sur trois, quelles qu'elles soient, et une troisième signature ou seed n'est pas requise. Ne suppose pas un seuil plus élevé que celui avec lequel ton portefeuille a été créé. Deux seeds seules peuvent toutefois ne pas suffire à reconstruire le portefeuille sans sa configuration complète ou son descripteur (clés publiques de tous les cosignataires, seuil, politique de script, chemins de dérivation) : vérifie cette sauvegarde et teste la récupération sans envoyer tes seeds ni tes clés à qui que ce soit.",
};
const MULTISIG_ALICE_CORRECTION: Localized = {
  en: 'Note: nothing in the notes available here describes a multisig import or restore feature in Alice Wallet. Follow the documentation of the wallet that created the multisig, and never send seeds or keys to anyone.',
  fr: "Précision : rien dans les notes disponibles ici ne décrit une fonction d'import ou de restauration multisig dans Alice Wallet. Suis la documentation du portefeuille qui a créé le multisig, et n'envoie jamais tes seeds ni tes clés à qui que ce soit.",
};
const RBF_OPT_IN_CORRECTION: Localized = {
  en: 'Correction: a replacement does not require that RBF was enabled or signaled when the payment was sent. Nodes and miners applying full-RBF, the default in Bitcoin Core since version 28.0, also accept a replacement of a transaction that did not signal it; signaling improves predictability, it is not a precondition everywhere. Whether a replacement can be attempted depends on your wallet and on node policies, and it is never guaranteed.',
  fr: "Correction : le remplacement n'exige pas que l'option RBF ait été activée ou signalée à l'envoi. Les nœuds et mineurs qui appliquent le full-RBF, comportement par défaut de Bitcoin Core depuis la version 28.0, acceptent aussi le remplacement d'une transaction qui ne l'a pas signalé ; le signal améliore la prévisibilité, ce n'est pas une condition partout. La possibilité de tenter un remplacement dépend de ton portefeuille et des politiques des nœuds, et elle n'est jamais garantie.",
};
const RBF_SECOND_PAYMENT_CORRECTION: Localized = {
  en: 'Correction: a second independent payment is not a way to fix or speed up the first one. If the original confirms, both payments go through and the recipient is paid twice. Only a replacement that spends the same inputs, built and verified in your wallet, can take the place of an unconfirmed transaction.',
  fr: "Correction : un second paiement indépendant ne corrige pas et n'accélère pas le premier. Si la transaction d'origine se confirme, les deux paiements passent et le destinataire est payé deux fois. Seul un remplacement qui dépense les mêmes entrées, construit et vérifié dans ton portefeuille, peut prendre la place d'une transaction non confirmée.",
};

// All patterns run on normalized sentences: lowercase, accents stripped,
// typographic quotes and hyphens folded, so "opérateur", "2‑of‑3" and
// "n’était" match their plain forms.
const BLOCKING_VERB = String.raw`(?:block(?:s|ing|ed)?|lock(?:s|ing|ed)?|freez(?:e|es|ing)|froze|prevent(?:s|ing|ed)?|refus(?:e|es|ing|ed|er)|den(?:y|ies|ying|ied)|veto(?:es|ed)?|stop(?:s|ping|ped)? you from|keep(?:s|ing)? you from|bloqu(?:e|er|ent|ant|era)|empech(?:e|er|ent|ant|era)|gel(?:e|er|ent)|verrouill(?:e|er|ent)|interdi(?:t|re|sent)|retien(?:t|nent)|retenir)`;
const EXIT_NOUN = String.raw`(?:exit(?:s|ing)?|withdraw(?:al|als|ing)?|leave|leaving|get(?:ting)? (?:your |the )?(?:funds|coins|money|bitcoins?) (?:out|back)|sortie|sorties|sortir|retrait|retirer|recuperer|quitter)`;
const OPERATOR = String.raw`(?:operator|operators|asp|server|provider|operateur|operateurs|serveur|fournisseur|it|they|il|elle|ils)`;
// A question, a sentence that opens on a quoted claim, or a refutation wording.
const REFUTATION = /\?$|^"[^"]*"|\b(?:myth|mythe|mythes|faux|fausse|false|untrue|not true|not the case|ce qui est faux|idee recue|idees recues|on entend (?:souvent |parfois )?dire|people (?:fear|think|believe|say|assume)|contrary to|contrairement a|misconception|wrongly|a tort)\b/;
// A quorum of three or more keys names another wallet than a 2-of-3.
const HIGH_M = String.raw`(?:[3-9]|\d{2,}|three|trois|four|quatre|five|cinq|six|seven|sept|eight|huit|nine|neuf)`;
const ANY_N = String.raw`(?:\d+|three|trois|four|quatre|five|cinq|six|seven|sept|eight|huit|nine|neuf)`;
const N_ABOVE_THREE = String.raw`(?:[4-9]|\d{2,}|four|quatre|five|cinq|six|seven|sept|eight|huit|nine|neuf)`;
const NEGATION = String.raw`(?:not|never|no|n't|cannot|can ?not|nor can|unable|without being able|ne|n'|jamais|aucun|aucune|ni|pas|non)`;

export const NEVER_CLAIM_CHECKS: readonly NeverClaimCheck[] = [
  {
    id: 'ark-operator-blocks-exit',
    notes: ARK_NOTES,
    patterns: [
      { test: new RegExp(String.raw`\b${OPERATOR}\b[^.!?]*\b${BLOCKING_VERB}\b[^.!?]*\b${EXIT_NOUN}\b`) },
      { test: /\b(?:you(?:'re| are| will be| would be| remain| stay| get| end up)|your (?:funds|coins|money)(?: are| will be| remain| stay)?|the (?:funds|coins))\b[^.!?]{0,40}\b(?:stuck|trapped|locked (?:in|up|out)|frozen)\b/ },
      { test: /\b(?:vous|tu) (?:restez|restes|etes|es|serez|seras|resterez|resteras|vous retrouvez|te retrouves|demeurez)\b[^.!?]{0,30}\b(?:coince|coinces|coincee|coincees|bloque|bloques|bloquee|bloquees|piege|pieges|piegee|piegees)\b/ },
      { test: /\b(?:fonds|bitcoins|pieces)\b[^.!?]{0,30}\b(?:restent|sont|seront) (?:coinces|bloques|pieges|geles)\b/ },
    ],
    unless: new RegExp(String.raw`\b${NEGATION}\b`),
    unlessScope: 'span',
    unlessSentence: REFUTATION,
    correction: ARK_EXIT_CORRECTION,
  },
  {
    id: 'ark-funds-lost',
    notes: ARK_NOTES,
    patterns: [
      { test: /\b(?:funds|coins|money|bitcoins?|sats|savings)\b[^.!?]{0,60}\b(?:are|is|will be|would be|get|gets|become|becomes) (?:lost|gone|confiscated|seized|forfeited|taken)\b/ },
      { test: /\b(?:fonds|bitcoins?|pieces|argent|sats|economies)\b[^.!?]{0,60}\b(?:sont|est|seront|serait|seraient|deviennent) (?:perdus?|perdues?|confisques?|confisquees?|saisis?|envoles?)\b/ },
    ],
    unless: new RegExp(String.raw`\b${NEGATION}\b|\b(?:exit data|backup|seed|donnees de sortie|sauvegarde)\b`),
    unlessScope: 'span',
    unlessSentence: REFUTATION,
    correction: ARK_EXIT_CORRECTION,
  },
  {
    id: 'ark-expiry-inverted',
    notes: ARK_NOTES,
    patterns: [
      { test: /\b(?:at|after|upon|once|when|past|a l'|apres|une fois|lorsque|quand|passe)\b[^.!?]{0,50}\b(?:expiry|expiration|expires|expired|expire|expirent|deadline|arrive a terme|arrive a expiration|echeance)\b[^.!?]{0,80}\b(?:becomes?|remains?|stays?|is|are|can be|can still be|recoverable|redeemable|claimable|spendable|reclaim(?:ed)?|claim(?:ed)?|recover(?:ed)?|redeem(?:ed)?|devient|deviennent|redevient|redeviennent|reste|restent|est|sont|peut etre|peuvent etre|recuperable|recuperables|recuperer|depensable|depensables|disponible|disponibles|utilisable|utilisables|publier|reclamer|claim)\b/ },
    ],
    unless: /\b(?:before|prior to|until|revert|reverts|returns? to the operator|goes back to the operator|lost|forfeit|forfeited|refresh|refreshed|no longer|not|cannot|can't|avant|jusqu'a|revient|retourne|reviennent|perd|perdu|perdue|rafraichi|rafraichir|rafraichis|ne|n')\b/,
    unlessScope: 'span',
    unlessSentence: REFUTATION,
    correction: ARK_EXPIRY_CORRECTION,
  },
  {
    id: 'multisig-quorum-inflated',
    notes: ['multisig'],
    patterns: [
      // "two seeds are not enough ... 2-of-3" (or "... 3-of-3" asserted for the user)
      { test: /\b(?:two|2|deux)(?: (?:of|de) (?:your|my|vos|mes|tes) (?:3|three|trois))? (?:seed|seeds|seed phrases?|keys?|cles?|signatures?)\b[^.!?]{0,80}\b(?:not enough|insufficient|not sufficient|ne suffi(?:t|sent)|insuffisant(?:s|es?)?|pas suffisant(?:s|es?)?)\b[^.!?]{0,120}\b(?:2|two|deux|3|three|trois)[- ](?:of|sur|de)[- ](?:3|three|trois)\b/ },
      // "the wallet requires three signatures", "il faut 3 signatures"
      {
        test: /\b(?:requires?|required|needs?|needed|must have|takes|il faut|il vous faut|il te faut|necessite|exige|requiert|faut)\b[^.!?]{0,40}\b(?:all )?(?:3|three|trois|les trois|toutes les trois|the three)\b[^.!?]{0,20}\b(?:signatures?|seeds?|keys?|cles?|cosigners?|cosignataires?)\b/,
        unless: /\b(?:any )?(?:two|2|deux) (?:of|sur|de|parmi|out of) (?:the |les |ses |its |your |vos |tes )?(?:three|3|trois)\b/,
      },
      // "you need to recover the third seed"
      { test: /\b(?:need|needs|must|have to|requires?|il (?:vous |te )?faut|devez|devrez|dois|devras)\b[^.!?]{0,30}\b(?:recover|find|retrieve|obtain|get|locate|recuperer|retrouver|obtenir)\b[^.!?]{0,20}\b(?:the |la |le |votre |your |ta |ton )?(?:third|3rd|troisieme|3e) (?:seed|key|cle|signature|cosigner|cosignataire)\b/ },
      // the user's wallet asserted to be 3-of-3
      { test: /\b(?:your|votre|vos|in your case|dans votre cas|dans ton cas|ton|ta|tes)\b[^.!?]{0,80}\b(?:3|three|trois)[- ](?:of|sur|de)[- ](?:3|three|trois)\b/ },
      { test: /\b(?:3|three|trois)[- ](?:of|sur|de)[- ](?:3|three|trois)\b[^.!?]{0,80}\b(?:your|votre|vos|in your case|dans votre cas|dans ton cas)\b/ },
    ],
    unless: /\b(?:descriptor|descripteur|(?:complete|full|wallet|exact) configuration|configuration (?:complete|du portefeuille|du wallet|exacte)|public keys?|cles? publiques?|xpub|derivation|on their own|alone|seules?|a elles seules|without|sans|backup|back up|sauvegard\w*|conserv\w*|store|stored|keep|kept|protect\w*|whether|unless|au cas ou|en cas de|instead of|rather than|plutot que|n'est pas|ne serait pas|different|differe|autre)\b|\b(?:3|three|trois)[- ](?:of|sur|de)[- ](?:3|three|trois)\b[^.!?]{0,40}\b(?:if|si|were|serait|etait|hypoth\w*)\b|\b(?:if|si)\b[^.!?]{0,60}\b(?:3|three|trois)[- ](?:of|sur|de)[- ](?:3|three|trois)\b|\bm[- ]of[- ]n\b|\bm (?:de|sur) n\b/,
    // A 3-of-5 or 4-of-7 named in the sentence is another wallet than the
    // user's 2-of-3; a 3-of-3 asserted for the user stays a claim.
    unlessSentence: new RegExp(String.raw`\b(?:(?:3|three|trois)[- ](?:of|sur|de|out of)[- ]${N_ABOVE_THREE}|${N_ABOVE_THREE}[- ](?:of|sur|de|out of)[- ]${ANY_N})\b`),
    unlessQuestion: new RegExp(String.raw`\b${HIGH_M}[- ]?(?:of|sur|de|out of|on)[- ]?${ANY_N}\b`),
    correction: MULTISIG_QUORUM_CORRECTION,
  },
  {
    id: 'multisig-alice-capability',
    notes: ['multisig'],
    patterns: [
      { test: /\balice(?: wallet)?\b[^.!?]{0,80}\b(?:import(?:er|ez|s|ed|ing)?|restaur(?:er|ez|e)|restor(?:e|es|ing)|recre(?:er|ez|e|ate|ates|ating)|rebuil(?:d|ds|ding)|reconstrui(?:re|t|sez)|supporte?s? (?:les |le |the |a )?multisig|cre(?:er|ez|e) (?:le |un |votre |ton )?portefeuille multisig|create (?:the |a |your )?multisig)\b/ },
      { test: /\b(?:import(?:er|ez)?|restor(?:e|ing)|restaur(?:er|ez)|rebuild|recre(?:er|ate))\b[^.!?]{0,60}\b(?:in|into|dans|sur|avec|with) alice\b/ },
    ],
    unless: new RegExp(String.raw`\b${NEGATION}\b`),
    correction: MULTISIG_ALICE_CORRECTION,
  },
  {
    id: 'rbf-opt-in-precondition',
    notes: RBF_NOTES,
    patterns: [
      { test: /\b(?:only|unless|seulement|uniquement|ne fonctionne que|ne marche que|n'est possible que|possible que)\b[^.!?]{0,80}\b(?:rbf|replace[- ]by[- ]fee|replaceable|remplacable|remplacement|replacement|rbf option|option rbf|flag|signal)\b[^.!?]{0,120}\b(?:enabled|activated|turned on|signal(?:l)?ed|flagged|marked|set|opted|checked|activ(?:e|ee|es|ees)|signal(?:e|ee|es|ees)|coch(?:e|ee)|marqu(?:e|ee))\b/ },
      { test: /\b(?:rbf|replace[- ]by[- ]fee|the (?:rbf )?(?:flag|option|signal)|l'option|le signal|le drapeau)\b[^.!?]{0,40}\b(?:(?:was|is|were|wasn't|isn't) not (?:enabled|activated|set|signal(?:l)?ed|turned on|marked)|n'(?:est|etait|a) pas (?:ete )?(?:activ(?:e|ee)|signal(?:e|ee)|coch(?:e|ee)|marqu(?:e|ee)))\b[^.!?]{0,100}\b(?:cannot|can't|can ?not|impossible|not possible|no way|won't be able|unable|ne (?:peut|pourra|pouvez|pourrez|pouvons|pourrons) pas)\b/ },
      { test: /\b(?:without|sans) (?:the |le |l'option |le signal |le drapeau )?(?:rbf|replace[- ]by[- ]fee)(?: flag| signal| option)?\b[^.!?]{0,60}\b(?:cannot|can't|can ?not|impossible|not possible|unable|ne (?:peut|pourra|pouvez|pourrez) pas)\b/ },
      { test: /\b(?:cannot|can't|can ?not|impossible|not possible|ne (?:peut|pourra|pouvez|pourrez) pas)\b[^.!?]{0,60}\b(?:without|sans|unless|a moins)\b[^.!?]{0,30}\b(?:rbf|replace[- ]by[- ]fee|signal|flag|option)\b/ },
    ],
    unless: /\b(?:opt[- ]in|full[- ]?rbf|some nodes|certain nodes|certains n(?:oe|œ)uds|not a precondition|pas une condition|n'exige pas|does not require|not required|improves? predictability|previsibilite|some wallets|wallets? (?:only |may |might )?(?:shows?|offers?|displays?|exposes?)|certains portefeuilles|portefeuilles? (?:ne )?(?:proposent?|affichent?|montrent?))\b/,
    correction: RBF_OPT_IN_CORRECTION,
  },
  {
    id: 'rbf-second-payment',
    notes: RBF_NOTES,
    patterns: [
      { test: /\b(?:create|creating|send|sending|make|making|broadcast|submit|issue)\b[^.!?]{0,40}\b(?:a |another |one )?(?:new|second|another|fresh|separate|different) (?:transaction|payment|tx)\b[^.!?]{0,80}\b(?:fresh|other|different|new|unrelated|separate) (?:inputs?|utxos?|coins?)\b/ },
      { test: /\b(?:send|sending|make|making|resend|re-send|pay|paying)\b[^.!?]{0,30}\b(?:a |one )?(?:second|another|new|duplicate) (?:payment|transaction|transfer)\b[^.!?]{0,60}\b(?:to (?:the )?same|same (?:recipient|address)|instead|as a (?:substitute|workaround|fix)|to (?:fix|correct|compensate|speed|replace)|the recipient again)\b/ },
      { test: /\b(?:cre(?:er|ez|e)|envoy(?:er|ez|e)|fai(?:re|tes|s)|refai(?:re|tes)|diffus(?:er|ez|e)|emett(?:re|ez))\b[^.!?]{0,40}\b(?:une |un )?(?:nouvelle|nouveau|seconde|second|deuxieme|autre) (?:transaction|paiement|envoi|virement)\b[^.!?]{0,80}\b(?:autres|nouvelles|nouveaux|differentes|differents) (?:entrees|utxos?|pieces|inputs?)\b/ },
      { test: /\b(?:renvoy(?:er|ez|e)|envoy(?:er|ez|e)|refai(?:re|tes)|repay(?:er|ez)|effectu(?:er|ez))\b[^.!?]{0,30}\b(?:un |une )?(?:second|seconde|deuxieme|nouveau|nouvelle|autre) (?:paiement|transaction|envoi|virement)\b[^.!?]{0,60}\b(?:au meme|a la meme|vers la meme|meme destinataire|meme adresse|a la place|en remplacement|pour (?:compenser|corriger|accelerer|remplacer|rattraper))\b/ },
    ],
    unless: /\b(?:do not|don't|never|not a|is not|isn't|should not|shouldn't|avoid|must not|mustn't|rather than|instead of|ne|n'|pas|jamais|evit\w*|sans|keeping|keeps?|same inputs?|original inputs?|replacement|remplacement|memes? entrees?|entrees? d'origine|conserv\w*)\b/,
    correction: RBF_SECOND_PAYMENT_CORRECTION,
  },
];

const RULES_BY_NOTE = new Map(ANSWER_RULES.map(rule => [rule.noteId, rule]));

export function normalizeAnswerText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/œ/g, 'oe')
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The rule notes present in a retrieved-knowledge text, in the order the
 * retrieval wrote them. The detection reads the "Topic:" line the retrieval
 * formats for every note (rag.ts), so it reflects exactly what the model sees,
 * including a note dropped by the context fit.
 */
export function answerRuleNoteIdsIn(text: string): string[] {
  if (!text) return [];
  const found: { index: number; noteId: string }[] = [];
  for (const rule of ANSWER_RULES) {
    const match = new RegExp(`^Topic: ${escapeRegExp(rule.title)}$`, 'm').exec(text);
    if (match) found.push({ index: match.index, noteId: rule.noteId });
  }
  return found.sort((a, b) => a.index - b.index).map(entry => entry.noteId);
}

/** The rule notes a prepared history carries in its system turns. */
export function answerRuleNoteIdsInMessages(messages: readonly { role: string; content: string }[]): string[] {
  return answerRuleNoteIdsIn(messages.filter(message => message.role === 'system').map(message => message.content).join('\n'));
}

const BLOCK_HEADER = '[Answer rules]';

function blockIntro(language: SupportedLanguage): string {
  return language === 'fr'
    ? "Les notes récupérées rendent obligatoires les points ci-dessous pour cette réponse. Formule chacun d'eux avec tes mots, dans l'ordre qui convient à la question, et n'affirme jamais l'inverse."
    : 'The retrieved notes make the points below mandatory for this answer. State each of them in your own words, in the order that fits the question, and never claim the opposite.';
}

function renderBlock(language: SupportedLanguage, state: string[], never: string[]): string {
  const parts = [BLOCK_HEADER, blockIntro(language)];
  if (state.length > 0) parts.push(language === 'fr' ? 'À dire :' : 'State:', ...state.map(line => `- ${line}`));
  if (never.length > 0) parts.push(language === 'fr' ? 'À ne jamais affirmer :' : 'Never claim:', ...never.map(line => `- ${line}`));
  return parts.join('\n');
}

/**
 * The instruction block for the rule notes of a turn, or '' when none is in
 * context. Sentences shared by two notes appear once. When the merged lines
 * exceed the budget, the last never-claim lines give way first, then the last
 * mandatory points, so the block never crowds out the notes themselves.
 */
export function answerRulesBlock(noteIds: readonly string[], language: SupportedLanguage, maxChars = ANSWER_RULES_MAX_CHARS): string {
  const rules = noteIds.map(id => RULES_BY_NOTE.get(id)).filter((rule): rule is AnswerRule => Boolean(rule));
  if (rules.length === 0) return '';
  const state = [...new Set(rules.flatMap(rule => rule.mustState[language]))];
  const never = [...new Set(rules.flatMap(rule => rule.neverClaim[language]))];
  let block = renderBlock(language, state, never);
  while (block.length > maxChars && (never.length > 0 || state.length > 0)) {
    if (never.length > 0) never.pop();
    else state.pop();
    block = renderBlock(language, state, never);
  }
  return block.length <= maxChars ? block : '';
}

function sentencesOf(text: string): string[] {
  return normalizeAnswerText(text).split(/(?<=[.!?])\s+|\n+/).map(sentence => sentence.trim()).filter(Boolean);
}

/** Every correction sentence an answer already carries, in either language. */
export function answerRuleCorrectionsIn(answer: string): string[] {
  const found: string[] = [];
  for (const check of NEVER_CLAIM_CHECKS) {
    for (const language of ['en', 'fr'] as const) {
      const correction = check.correction[language];
      if (answer.includes(correction) && !found.includes(correction)) found.push(correction);
    }
  }
  return found;
}

function sentenceClaims(check: NeverClaimCheck, sentence: string): boolean {
  for (const pattern of check.patterns) {
    const match = pattern.test.exec(sentence);
    if (!match) continue;
    if (pattern.unless?.test(sentence)) continue;
    if (check.unlessSentence?.test(sentence)) continue;
    if (check.unless) {
      const scope = check.unlessScope === 'span'
        ? sentence.slice(Math.max(0, match.index - 30), match.index + match[0].length + 30)
        : sentence;
      if (check.unless.test(scope)) continue;
    }
    return true;
  }
  return false;
}

export type AnswerRuleCheckResult = {
  text: string;
  /** Ids of the checks that matched and whose correction was appended. */
  applied: string[];
};

/**
 * Tests the answer against the never-claim patterns of the notes that were in
 * context and appends each triggered correction once, in the user's language,
 * after the answer. A correction already present is never repeated, and the
 * correction text itself is not scanned.
 */
export function withAnswerRuleCorrections(
  answer: string,
  language: SupportedLanguage,
  noteIds: readonly string[],
  question = '',
): AnswerRuleCheckResult {
  if (!answer.trim() || noteIds.length === 0) return { text: answer, applied: [] };
  const active = new Set(noteIds);
  const existing = answerRuleCorrectionsIn(answer);
  const scanned = existing.reduce((text, correction) => text.split(correction).join(' '), answer);
  const sentences = sentencesOf(scanned);
  const normalizedQuestion = normalizeAnswerText(question);
  const applied: string[] = [];
  const corrections: string[] = [];
  for (const check of NEVER_CLAIM_CHECKS) {
    if (!check.notes.some(note => active.has(note))) continue;
    if (check.unlessQuestion && check.unlessQuestion.test(normalizedQuestion)) continue;
    if (!sentences.some(sentence => sentenceClaims(check, sentence))) continue;
    const correction = check.correction[language];
    if (existing.includes(correction) || corrections.includes(correction)) continue;
    applied.push(check.id);
    corrections.push(correction);
  }
  if (corrections.length === 0) return { text: answer, applied };
  return { text: `${answer.trimEnd()}\n\n${corrections.join('\n\n')}`, applied };
}
