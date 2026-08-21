// The Explorer Fiche corpus: the reviewed, sourced knowledge Alice retrieves
// from. Each Fiche is authored here (original wording, not copied from sources)
// and projected into an alice-ai KnowledgePack for retrieval. Guards stay on the
// Fiche and are enforced by our code; the pack only carries the retrievable text.

import type { KnowledgePack } from '@alice-wallet/alice-ai';
import { disclaimerFor, ficheToKnowledgeChunk, ficheTranslationToChunk, type Fiche } from './fiche.ts';
import { FICHE_FR } from './fiche-corpus.fr.ts';

const CHECKED = '2026-08-13';

// FICHE_ADDRESS_REUSE, the remediation and impact for the ADDRESS_REUSE rule.
// Advice to use a fresh address per payment is uncontroversial and safe to
// recommend. Past reuse is permanent (irreversible), only the future is fixable.
const FICHE_ADDRESS_REUSE: Fiche = {
  id: 'FICHE_ADDRESS_REUSE',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'Address reuse',
  summary: 'Reusing one address ties all its payments together in public. Use a fresh address for every payment.',
  body:
    'A Bitcoin address is meant to be used once. When the same address receives ' +
    'more than one payment, anyone reading the chain can see those payments share ' +
    'an owner, and any label attached to the address (a forum signature, a public ' +
    'donation page, a receipt) attaches to all of them at once. The link is ' +
    'permanent and cannot be removed after the fact, so the fix is forward-looking: ' +
    'hand out a new address to each payer, which most wallets generate ' +
    'automatically. This does not undo past reuse, it stops the history from ' +
    'growing.',
  appliesTo: ['ADDRESS_REUSE'],
  retrievalHints: [
    'address reuse', 'reused address', 'fresh address', 'new address per payment',
    'avoid reuse', 'address privacy', 'receiving address',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'trivial',
  cost: 'none',
  reversibility: 'irreversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [
    { url: 'https://en.bitcoin.it/wiki/Privacy', label: 'Bitcoin Wiki: Privacy (address reuse)', checkedAt: CHECKED },
    { url: 'https://bitcoin.org/en/protect-your-privacy', label: 'bitcoin.org: Protect your privacy', checkedAt: CHECKED },
  ],
  stability: 'stable',
};

// FICHE_COIN_CONTROL, choosing which UTXOs a transaction spends. A best
// practice Alice may propose freely.
const FICHE_COIN_CONTROL: Fiche = {
  id: 'FICHE_COIN_CONTROL',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'Coin control',
  summary: 'Pick by hand which coins a transaction spends, so you do not link histories you meant to keep apart.',
  body:
    'Coin control is choosing by hand which unspent outputs (UTXOs) a transaction ' +
    'spends, instead of letting the wallet pick automatically. It matters for ' +
    'privacy because combining several inputs in one transaction publicly links ' +
    'them as one owner (the common-input-ownership heuristic). Deliberately keeping ' +
    'coins with different histories apart, KYC from non-KYC, a public donation from ' +
    'private savings, avoids creating links you did not intend. UTXO labels make it ' +
    'practical, and most desktop wallets expose the feature; using it is a habit, ' +
    'not a one-off.',
  appliesTo: [],
  retrievalHints: [
    'coin control', 'coin selection', 'utxo selection', 'choose inputs', 'contrôle des pièces',
    'sélection des UTXO', 'gestion des UTXO',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [
    { url: 'https://bitcoinops.org/en/topics/coin-selection/', label: 'Bitcoin Optech: Coin selection', checkedAt: CHECKED },
    { url: 'https://en.bitcoin.it/wiki/Privacy', label: 'Bitcoin Wiki: Privacy (common-input-ownership)', checkedAt: CHECKED },
  ],
  stability: 'stable',
};

// FICHE_SILENT_PAYMENTS, a static address that still lands each payment on a
// distinct output. Directly remediates address reuse.
const FICHE_SILENT_PAYMENTS: Fiche = {
  id: 'FICHE_SILENT_PAYMENTS',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'Silent Payments',
  summary: 'Publish one static address while every payment still lands on a different, unlinkable output.',
  body:
    'Silent Payments (BIP 352) let a receiver publish one static address while every ' +
    'payment still lands on a different, unlinkable on-chain output. The sender ' +
    'derives a unique destination from the receiver public key and the transaction ' +
    'own inputs, with no separate notification transaction. It resolves the core ' +
    'tension of a public, reusable address: you can share one address for donations ' +
    'or a profile without tying all incoming payments together. The trade-off is ' +
    'that the receiver must scan the chain to find payments, and wallet support is ' +
    'still growing.',
  appliesTo: ['ADDRESS_REUSE'],
  retrievalHints: [
    'silent payments', 'BIP352', 'static address', 'reusable address', 'paiements silencieux',
    'adresse statique', 'réutilisation d\'adresse',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [
    { url: 'https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki', label: 'BIP 352: Silent Payments', checkedAt: CHECKED },
  ],
  stability: 'stable',
};

// FICHE_PAYJOIN, a collaborative payment where the receiver also adds an input,
// breaking the common-input-ownership assumption.
const FICHE_PAYJOIN: Fiche = {
  id: 'FICHE_PAYJOIN',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'PayJoin',
  summary: 'A normal-looking payment where the receiver also adds an input, misleading input-based chain analysis.',
  body:
    'PayJoin (BIP 78, also called P2EP) is a normal-looking payment where the ' +
    'receiver also contributes one of their own inputs. That breaks the common ' +
    'assumption that every input of a transaction belongs to a single payer, so ' +
    'analysis reading inputs as one owner is misled. Because the result looks like ' +
    'an ordinary payment, it also helps other users by making the heuristic less ' +
    'reliable in general. Adoption depends on both the wallet and the receiver ' +
    '(merchant or server) supporting it.',
  appliesTo: [],
  retrievalHints: [
    'payjoin', 'BIP78', 'P2EP', 'pay to endpoint', 'collaborative transaction', 'transaction collaborative',
    'common input ownership',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'fees_only',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [
    { url: 'https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki', label: 'BIP 78: A Simple Payjoin Proposal', checkedAt: CHECKED },
  ],
  stability: 'stable',
};

// Shared, verified sources, so a fiche cites them without repeating the URL.
const SRC_WIKI_PRIVACY = { url: 'https://en.bitcoin.it/wiki/Privacy', label: 'Bitcoin Wiki: Privacy', checkedAt: CHECKED };
const SRC_BOLTZMANN = { url: 'https://github.com/Dojo-Open-Source-Project/dojo-tools/tree/master/packages', label: 'Dojo: Boltzmann (TypeScript port)', checkedAt: CHECKED };
const SRC_WIKIPEDIA_SAMOURAI = { url: 'https://en.wikipedia.org/wiki/Samourai_Wallet', label: 'Wikipedia: Samourai Wallet', checkedAt: CHECKED };
const SRC_WIKIPEDIA_TUMBLER = { url: 'https://en.wikipedia.org/wiki/Cryptocurrency_tumbler', label: 'Wikipedia: Cryptocurrency tumbler', checkedAt: CHECKED };
const SRC_WIKIPEDIA_TORNADO = { url: 'https://en.wikipedia.org/wiki/Tornado_Cash', label: 'Wikipedia: Tornado Cash', checkedAt: CHECKED };

// ---- Lot B: on-chain techniques ----

// CoinJoin is a legitimate privacy technique Alice may propose. The specific
// implementations, with their shifting legal status, live in the landscape fiche
// below, which stays educational_only.
const FICHE_COINJOIN: Fiche = {
  id: 'FICHE_COINJOIN',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'concept',
  locale: 'en',
  title: 'CoinJoin',
  summary: 'A collaborative transaction where several users share inputs and equal-value outputs, weakening the link between who paid whom.',
  body:
    'A CoinJoin is a single transaction that several users build together, ' +
    'combining their inputs and producing equal-value outputs, so an observer can ' +
    'no longer tell which input funded which output. It does not hide the ' +
    'transaction; it breaks the common-input-ownership heuristic by making many ' +
    'pairings plausible. The Chaumian variant uses blind signatures so the ' +
    'coordinator arranging the round cannot itself relink the registered inputs to ' +
    'the final outputs. The privacy gained is only as good as the equal-output ' +
    'ambiguity (the anonymity set) and, above all, what the user does afterward: ' +
    'spending the change or the mixed coins carelessly can undo it (see toxic ' +
    'change). CoinJoin is a workflow, not a one-click fix.',
  appliesTo: ['COINJOIN', 'POSTMIX'],
  retrievalHints: [
    'coinjoin', 'collaborative transaction', 'equal outputs', 'chaumian coinjoin',
    'blind signatures', 'breaking common input ownership', 'transaction collaborative', 'mélange collaboratif',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'medium',
  cost: 'fees_only',
  reversibility: 'irreversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY],
  stability: 'stable',
};

// The implementation landscape, which 2024 enforcement reshaped: volatile by
// nature, reviewed quarterly.
const FICHE_COINJOIN_LANDSCAPE: Fiche = {
  id: 'FICHE_COINJOIN_LANDSCAPE',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'tool',
  locale: 'en',
  title: 'CoinJoin implementations and their status',
  summary: 'The main CoinJoin implementations and how 2024 enforcement reshaped the landscape.',
  body:
    'CoinJoin implementations differ mainly in how they coordinate. JoinMarket is a ' +
    'non-custodial market where makers offer liquidity to takers for a fee, with no ' +
    'central coordinator. Wasabi used a coordinator with the WabiSabi protocol. ' +
    'Whirlpool, from Samourai Wallet, used fixed-amount pools with a preparatory ' +
    'transaction (TX0), mixes and free remixes. Samourai also shipped related ' +
    'techniques: Stonewall (a single-user transaction shaped to look like a small ' +
    'collaboration, Stonewall x2 adding a real second party) and Ricochet (extra ' +
    'intermediate hops to distance funds from a flagged source). In 2024 the ground ' +
    'shifted: the Samourai founders were charged by the U.S. DOJ in April 2024 with ' +
    'money laundering and running an unlicensed money transmitter, and the Wasabi ' +
    'coordinator was shut down. Ashigaru, a community fork, continues the Whirlpool ' +
    'and Dojo tooling, and newer designs such as JoinStr coordinate over Nostr to ' +
    'remove the central coordinator entirely. Availability and legal exposure vary ' +
    'by tool and jurisdiction and change quickly.',
  appliesTo: ['PREMIX'],
  retrievalHints: [
    'whirlpool', 'wasabi', 'wabisabi', 'joinmarket', 'ashigaru', 'joinstr', 'samourai',
    'stonewall', 'ricochet', 'coinjoin coordinator', 'tx0', 'postmix',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'medium',
  cost: 'fees_only',
  reversibility: 'irreversible',
  legalPosture: 'educational_only',
  disclaimer: disclaimerFor('educational_only'),
  sources: [SRC_WIKIPEDIA_SAMOURAI, SRC_WIKI_PRIVACY],
  stability: 'volatile',
};

// Reusable payment codes: a recommendable way to avoid reuse for repeat payers.
const FICHE_BIP47_PAYNYM: Fiche = {
  id: 'FICHE_BIP47_PAYNYM',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'Reusable payment codes (BIP 47 / PayNym)',
  summary: 'Publish one payment code; each sender derives fresh addresses for you, avoiding address reuse for recurring payments.',
  body:
    'BIP 47 reusable payment codes let you publish a single code (a PayNym is one ' +
    'implementation) instead of a static address. Each payer combines your code with ' +
    'a shared derivation (ECDH) to compute a fresh, unique address for every payment, ' +
    'so recurring payments no longer pile onto one reused address. The cost is an ' +
    'on-chain notification transaction to establish the relationship the first time, ' +
    'which leaves a small footprint, and both wallets must support it. It solves the ' +
    'same problem as Silent Payments, a shareable static handle without reuse, with a ' +
    'different trade-off.',
  appliesTo: ['ADDRESS_REUSE'],
  retrievalHints: [
    'BIP47', 'payment code', 'reusable payment code', 'paynym', 'notification transaction',
    'code de paiement réutilisable',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'fees_only',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [{ url: 'https://github.com/bitcoin/bips/blob/master/bip-0047.mediawiki', label: 'BIP 47: Reusable Payment Codes', checkedAt: CHECKED }],
  stability: 'stable',
};

const FICHE_TOXIC_CHANGE: Fiche = {
  id: 'FICHE_TOXIC_CHANGE',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'threat',
  locale: 'en',
  title: 'Toxic change',
  summary: 'A change output that keeps a link to a sensitive source; spending it with private coins re-exposes you.',
  body:
    'Toxic change is a change output that still carries a link to a sensitive origin, ' +
    'for example the change left by a CoinJoin preparation (TX0) or by spending ' +
    'flagged coins. It can be singled out by amount, script or behaviour heuristics. ' +
    'The danger comes after the transaction: if you later spend that change together ' +
    'with private funds, the common-input-ownership heuristic reconnects the two ' +
    'histories you tried to separate. Isolating it with labels and coin control, and ' +
    'not merging it with clean coins, is what keeps the earlier privacy work intact.',
  appliesTo: [],
  retrievalHints: ['toxic change', 'change output', 'postmix', 'tx0 change', 'monnaie rendue toxique'],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY],
  stability: 'stable',
};

const FICHE_CONSOLIDATION: Fiche = {
  id: 'FICHE_CONSOLIDATION',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'concept',
  locale: 'en',
  title: 'Consolidation and its privacy cost',
  summary: 'Merging many UTXOs into one is cheap on fees but publicly links coins that were separate.',
  body:
    'Consolidation merges several UTXOs into one or a few outputs, often to save on ' +
    'future fees when the mempool is cheap. It is a reasonable fee optimisation, but ' +
    'it has a privacy cost: putting several coins into one transaction triggers the ' +
    'common-input-ownership heuristic and publicly ties together histories that were ' +
    'previously separate. Keep fee optimisation and privacy as separate decisions: ' +
    'consolidate coins that already belong to the same visible cluster, and never ' +
    'merge KYC with non-KYC or unrelated compartments just to save fees.',
  appliesTo: ['CONSOLIDATION'],
  retrievalHints: ['consolidation', 'merge utxos', 'utxo consolidation', 'common input ownership', 'consolidation UTXO'],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'fees_only',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY],
  stability: 'stable',
};

// ---- Lot C: analysis concepts (help Alice explain the signals) ----

const FICHE_CIOH: Fiche = {
  id: 'FICHE_CIOH',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'threat',
  locale: 'en',
  title: 'Common-input-ownership heuristic',
  summary: 'The assumption that all inputs of a transaction share one owner. Powerful, but not always true.',
  body:
    'The common-input-ownership heuristic (CIOH) assumes that if a transaction has ' +
    'several inputs, one entity controls them all, because each input must be signed ' +
    'to be spent. It holds well for ordinary, non-collaborative transactions and is a ' +
    'cornerstone of on-chain surveillance. It is defeated by collaborative ' +
    'transactions: CoinJoin and PayJoin deliberately place inputs from different ' +
    'owners in the same transaction, so reading the inputs as one owner becomes ' +
    'wrong. Consolidation, on the other hand, strengthens it. Knowing its limits is ' +
    'what keeps chain analysis honest: it produces hypotheses, not proof.',
  appliesTo: ['CIOH'],
  retrievalHints: ['common input ownership', 'CIOH', 'input clustering', 'multi-input heuristic', 'heuristique de propriété commune'],
  preconditions: [],
  contraindications: [],
  effort: 'trivial',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY],
  stability: 'stable',
};

const FICHE_TRANSACTION_HEURISTICS: Fiche = {
  id: 'FICHE_TRANSACTION_HEURISTICS',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'threat',
  locale: 'en',
  title: 'Transaction heuristics',
  summary: 'Inference rules used to read a transaction: which output is change, which inputs are linked, what wallet made it.',
  body:
    'Transaction heuristics are inference rules analysts use to interpret a ' +
    'transaction without proof of identity. Internal heuristics read the transaction ' +
    'itself: amounts, round numbers, output types, input ordering (for example ' +
    'BIP 69), script types, and change patterns. External heuristics add off-chain ' +
    'context: KYC records, timing, reused addresses, public disclosures, leaks. No ' +
    'single heuristic proves ownership, but several combined can sharply reduce ' +
    'uncertainty. Collaborative transactions and wallets that avoid tell-tale ' +
    'patterns weaken them. Reasoning about surveillance means separating what is ' +
    'proven on-chain from what is only inferred by a model.',
  appliesTo: ['CHANGE_DETECTION', 'WALLET_FINGERPRINT', 'SCRIPT_TYPE_MIX', 'ROUND_AMOUNT', 'DUST_OUTPUT', 'DUST_SPENDING'],
  retrievalHints: ['transaction heuristics', 'change detection', 'round number', 'bip69', 'wallet fingerprint', 'heuristiques de transaction'],
  preconditions: [],
  contraindications: [],
  effort: 'trivial',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY],
  stability: 'stable',
};

const FICHE_ANONYMITY_SET: Fiche = {
  id: 'FICHE_ANONYMITY_SET',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'concept',
  locale: 'en',
  title: 'Anonymity set',
  summary: 'The set of plausible interpretations around a coin. The bigger it is, the harder to link an input to an output.',
  body:
    'An anonymity set measures how many plausible interpretations surround a coin or ' +
    'transaction. In a CoinJoin with equal-value outputs, each output could plausibly ' +
    'match several inputs, and the larger that set, the harder it is to link a ' +
    'specific input to a specific output. It is a probabilistic idea, not a ' +
    'guarantee: a large set on paper is worthless if the user later merges coins or ' +
    'reuses an address and collapses the ambiguity. Metrics like transaction entropy ' +
    'try to quantify it. Framing privacy as the size of an anonymity set, rather than ' +
    'anonymous-or-not, is the more honest picture.',
  appliesTo: ['ANONYMITY_SET'],
  retrievalHints: ['anonymity set', 'anonset', 'forward-looking anonset', 'equal outputs', 'ensemble d\'anonymat'],
  preconditions: [],
  contraindications: [],
  effort: 'trivial',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY, SRC_BOLTZMANN],
  stability: 'stable',
};

const FICHE_ENTROPY_ANALYSIS: Fiche = {
  id: 'FICHE_ENTROPY_ANALYSIS',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'concept',
  locale: 'en',
  title: 'Transaction entropy (Boltzmann)',
  summary: 'A measure of how many valid input-output interpretations a transaction has. Higher entropy, more ambiguity.',
  body:
    'Transaction entropy counts and weights the valid ways to pair a transaction ' +
    'inputs with its outputs: many plausible interpretations mean high entropy and ' +
    'good ambiguity (typical of a CoinJoin), while a single interpretation means the ' +
    'transaction reads cleanly. The Boltzmann algorithm by LaurentMT formalises this ' +
    'and also derives a probability of link between each input and each output; a ' +
    'maintained TypeScript port lives in the Dojo tooling. Efficiency compares the ' +
    'entropy achieved to the maximum possible for that shape. Entropy is a vocabulary ' +
    'for ambiguity, not a promise of anonymity: deterministic links can still pin ' +
    'things down despite a complex-looking structure, and the computation explodes ' +
    'combinatorially past a dozen inputs and outputs.',
  appliesTo: ['ENTROPY'],
  retrievalHints: ['entropy', 'boltzmann', 'transaction entropy', 'link probability', 'deterministic links', 'entropie de transaction'],
  preconditions: [],
  contraindications: [],
  effort: 'trivial',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_BOLTZMANN, SRC_WIKI_PRIVACY],
  stability: 'stable',
};

const FICHE_CHAIN_ANALYSIS: Fiche = {
  id: 'FICHE_CHAIN_ANALYSIS',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'threat',
  locale: 'en',
  title: 'Chain analysis',
  summary: 'Using public blockchain data plus off-chain context to cluster addresses, infer owners and follow funds.',
  body:
    'Chain analysis exploits the public blockchain to cluster transactions, infer ' +
    'owners, follow flows and attach identity probabilities. It combines on-chain ' +
    'heuristics (input clustering, change detection, amounts, timing, script types) ' +
    'with off-chain data (KYC records, public addresses, leaks). Results are ' +
    'probabilistic hypotheses, more or less robust, not proof. It is why Bitcoin is ' +
    'pseudonymous, not anonymous, by default. The defences mirror the heuristics: ' +
    'reduce the links you create, avoid obvious patterns, and minimise the off-chain ' +
    'data that ties an address to you.',
  appliesTo: ['PEEL_CHAIN'],
  retrievalHints: ['chain analysis', 'blockchain surveillance', 'clustering', 'address clustering', 'fund tracing', 'analyse de chaîne', 'surveillance'],
  preconditions: [],
  contraindications: [],
  effort: 'trivial',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY],
  stability: 'stable',
};

// ---- Lot D: custodial mixers (never recommended, explained on request) ----

const FICHE_CUSTODIAL_MIXER: Fiche = {
  id: 'FICHE_CUSTODIAL_MIXER',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'threat',
  locale: 'en',
  title: 'Custodial mixers (tumblers)',
  summary: 'A service you hand custody of coins to, that returns other coins to obscure the trail. The category with the heaviest legal exposure.',
  body:
    'A custodial mixer, or tumbler, is a service you send coins to; it pools them ' +
    'with funds from other users and sends back different coins, charging roughly 1 ' +
    'to 3 percent, to obscure the trail back to the source. Unlike a non-custodial ' +
    'CoinJoin, you give up custody to the operator, who could steal the funds, log ' +
    'them, or be compelled to disclose, so there is counterparty and privacy risk on ' +
    'top of everything else. This is the category carrying the heaviest regulatory ' +
    'exposure. Documented enforcement includes Blender.io (sanctioned by the U.S. ' +
    'Treasury in 2022 over North-Korean laundering) and ChipMixer (seized in March ' +
    '2023 with about 46 million dollars). Tornado Cash, a non-custodial contract ' +
    'rather than a tumbler, was sanctioned on 8 August 2022; the U.S. Fifth Circuit ' +
    'then ruled on 26 November 2024 that its immutable contracts were not sanctionable ' +
    'property, and the Treasury removed it from the SDN list on 21 March 2025. Rules ' +
    'differ by jurisdiction and move fast.',
  appliesTo: [],
  retrievalHints: [
    'mixer', 'tumbler', 'coin mixer', 'washer', 'custodial mixer', 'tornado cash',
    'blender', 'chipmixer', 'mélangeur', 'mixeur',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'high',
  cost: 'significant',
  reversibility: 'irreversible',
  legalPosture: 'explain_never_recommend',
  disclaimer: disclaimerFor('explain_never_recommend'),
  sources: [SRC_WIKIPEDIA_TUMBLER, SRC_WIKIPEDIA_TORNADO],
  stability: 'volatile',
};

// ---- Lot E: acquisition and network privacy ----

const SRC_ROBOSATS = { url: 'https://robosats.com', label: 'RoboSats: official site', checkedAt: CHECKED };
const SRC_BISQ = { url: 'https://bisq.network', label: 'Bisq: official site', checkedAt: CHECKED };

const FICHE_KYC_EXPOSURE: Fiche = {
  id: 'FICHE_KYC_EXPOSURE',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'threat',
  locale: 'en',
  title: 'KYC exposure',
  summary: 'Buying through a KYC service permanently ties your identity to your coins and their history; withdrawing to self-custody does not erase it.',
  appliesTo: ['ENTITY_LINK'],
  body:
    'Acquiring bitcoin through a KYC service (an exchange that verifies your ' +
    'identity) creates a durable link between your civil identity, your purchase ' +
    'history and the coins you withdraw. Moving to self-custody does not remove that ' +
    'record: the exchange still knows which addresses you withdrew to, and it can be ' +
    'breached, subpoenaed, or sell data. A leaked KYC database, names, home ' +
    'addresses, IDs, holdings, turns a privacy problem into a physical-security one ' +
    '(phishing, extortion, burglary). Privacy therefore starts at acquisition, not ' +
    'only at spending. If you do use KYC, keep KYC and non-KYC coins in separate ' +
    'compartments with labels and coin control, and never merge them.',
  retrievalHints: ['KYC', 'know your customer', 'exchange', 'data leak', 'identity linkage', 'vérification identité', 'fuite de données'],
  preconditions: [],
  contraindications: [],
  effort: 'trivial',
  cost: 'none',
  reversibility: 'irreversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY],
  stability: 'stable',
};

const FICHE_NON_KYC_ACQUISITION: Fiche = {
  id: 'FICHE_NON_KYC_ACQUISITION',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'tool',
  locale: 'en',
  title: 'No-KYC acquisition (peer-to-peer)',
  summary: 'Buying bitcoin peer-to-peer avoids handing your identity to an exchange, at the cost of counterparty and personal-safety risk.',
  body:
    'Acquiring bitcoin peer-to-peer, directly from another person or through a ' +
    'matching platform, avoids the central identity collection of a KYC exchange. ' +
    'RoboSats is a non-custodial P2P exchange settling over Lightning with ephemeral ' +
    'robot identities and no account, reachable over Tor. Bisq is a decentralised, ' +
    'non-custodial desktop exchange with no KYC, using 2-of-2 multisig escrow over a ' +
    'peer-to-peer network. Both trade privacy for other risks: counterparty and scam ' +
    'risk, a price premium, dispute handling, and, for cash meetups, physical safety. ' +
    'Amounts and methods should match your threat model, and P2P is never risk-free.',
  appliesTo: [],
  retrievalHints: ['no-kyc', 'non-KYC', 'P2P exchange', 'robosats', 'bisq', 'peer to peer', 'sans KYC', 'acquisition P2P'],
  preconditions: [],
  contraindications: [],
  effort: 'medium',
  cost: 'significant',
  reversibility: 'reversible',
  legalPosture: 'educational_only',
  disclaimer: disclaimerFor('educational_only'),
  sources: [SRC_ROBOSATS, SRC_BISQ, SRC_WIKI_PRIVACY],
  stability: 'volatile',
};

const FICHE_OWN_NODE: Fiche = {
  id: 'FICHE_OWN_NODE',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'Use your own node (and Tor)',
  summary: 'Connect your wallet to your own node so you do not reveal your addresses to a third-party server, and route over Tor to hide your IP.',
  body:
    'When a wallet talks to a third-party server (a block explorer or a light-wallet ' +
    'backend), that server learns which addresses are yours and the IP you connect ' +
    'from. Running your own node and pointing your wallet at it keeps that lookup at ' +
    'home, so no third party sees your address set. Routing the connection over Tor ' +
    'hides your IP and, at broadcast time, helps against network-level origin tracing ' +
    '(techniques like Dandelion and P2P Transport v2 harden the first propagation). ' +
    'Node-in-a-box projects (Umbrel, Start9, RoninDojo, Dojo) make this practical. It ' +
    'directly addresses the weak spot of a hosted explorer: the server seeing what ' +
    'you look up.',
  appliesTo: [],
  retrievalHints: ['own node', 'full node', 'personal node', 'tor', 'dandelion', 'network privacy', 'umbrel', 'start9', 'ronindojo', 'dojo', 'nœud personnel', 'confidentialité réseau'],
  preconditions: [],
  contraindications: [],
  effort: 'medium',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_WIKI_PRIVACY],
  stability: 'stable',
};

// ---- Lot F: device and operational security ----

const SRC_EFF_SSD = { url: 'https://ssd.eff.org', label: 'EFF: Surveillance Self-Defense', checkedAt: CHECKED };
const SRC_TOR = { url: 'https://www.torproject.org', label: 'The Tor Project', checkedAt: CHECKED };
const SRC_GRAPHENEOS = { url: 'https://grapheneos.org', label: 'GrapheneOS', checkedAt: CHECKED };

const FICHE_TOR: Fiche = {
  id: 'FICHE_TOR',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'tool',
  locale: 'en',
  title: 'Tor',
  summary: 'Routes your traffic through several relays to hide your IP and reach .onion services. Protects the network layer, not the whole picture.',
  body:
    'Tor sends your traffic through several volunteer relays, encrypting it at each ' +
    'hop, so the sites you reach do not see your real IP and your local network or ' +
    'ISP does not see where you go; it also reaches .onion services. It protects the ' +
    'network layer only, not the security of the site or the device, and it is not ' +
    'magic: careless behaviour, logging into a named account, or mixing Tor and ' +
    'non-Tor sessions can still correlate you. For Bitcoin it matters because it ' +
    'hides the IP behind your wallet and node connections and your broadcasts. It is ' +
    'legal and widely used by journalists, researchers and people under censorship.',
  appliesTo: [],
  retrievalHints: ['tor', 'onion', 'network anonymity', 'hide IP', 'relays', 'anonymat réseau'],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_TOR],
  stability: 'stable',
};

const FICHE_GRAPHENEOS: Fiche = {
  id: 'FICHE_GRAPHENEOS',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'tool',
  locale: 'en',
  title: 'GrapheneOS',
  summary: 'A hardened, privacy-focused Android-based OS for Pixel phones, for a device that holds keys or sensitive apps.',
  body:
    'GrapheneOS is an open-source, hardened operating system based on the Android ' +
    'Open Source Project, focused on security and privacy. It removes Google services ' +
    'by default (with an optional sandboxed Play layer), adds strong app isolation and ' +
    'granular permission control, and ships fast security updates. It runs only on ' +
    'Google Pixel devices, which provide the hardware attestation it relies on. For a ' +
    'Bitcoiner the mobile OS is often the weak link, a phone holding a Lightning ' +
    'wallet, 2FA, or sensitive communications, and GrapheneOS meaningfully reduces ' +
    'that attack surface.',
  appliesTo: [],
  retrievalHints: ['grapheneos', 'hardened android', 'pixel', 'mobile OS security', 'de-googled', 'sécurité mobile'],
  preconditions: [],
  contraindications: [],
  effort: 'medium',
  cost: 'significant',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_GRAPHENEOS],
  stability: 'stable',
};

const FICHE_VPN: Fiche = {
  id: 'FICHE_VPN',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'tool',
  locale: 'en',
  title: 'VPN and its limits',
  summary: 'A VPN moves trust from your ISP to the VPN provider. Useful on untrusted Wi-Fi, but it does not make you anonymous.',
  body:
    'A VPN encrypts traffic between your device and a VPN provider, hiding your ' +
    'activity from the local network and your ISP, but it shifts that visibility to ' +
    'the provider, who becomes a single point of observation. It does not make you ' +
    'anonymous and it is often oversold. It genuinely helps on untrusted Wi-Fi and ' +
    'against a snooping ISP. For Bitcoin, treat it as one layer alongside Tor, your ' +
    'own node, and a clear threat model, not a substitute for them; a logging or ' +
    'compromised provider can undo the benefit.',
  appliesTo: [],
  retrievalHints: ['vpn', 'mullvad', 'isp', 'wifi', 'network privacy', 'confidentialité réseau'],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'significant',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_EFF_SSD],
  stability: 'stable',
};

const FICHE_PASSWORD_MANAGER: Fiche = {
  id: 'FICHE_PASSWORD_MANAGER',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'Password manager',
  summary: 'Generate and store a unique strong password per account, so one breach cannot cascade.',
  body:
    'A password manager generates, stores and fills a unique, strong password for ' +
    'every account, which removes password reuse, the reason one leaked site ' +
    'compromises many. Protect it with a strong, memorable master password, and back ' +
    'up the database on a clear plan. It also helps spot fake login domains, since it ' +
    'will not autofill on a lookalike site. It does not replace two-factor ' +
    'authentication on critical accounts (email, exchanges, cloud). This is one of ' +
    'the highest-leverage security improvements you can make.',
  appliesTo: [],
  retrievalHints: ['password manager', 'strong password', 'password reuse', 'bitwarden', 'credentials', 'gestionnaire de mots de passe'],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_EFF_SSD],
  stability: 'stable',
};

const FICHE_2FA: Fiche = {
  id: 'FICHE_2FA',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'Two-factor authentication',
  summary: 'Add a second factor beyond the password; prefer app-based (TOTP) or hardware keys over SMS.',
  body:
    'Two-factor authentication adds a second step to login beyond the password. The ' +
    'factors are not equal: SMS codes only prove possession of a phone number, which ' +
    'an attacker can hijack with a SIM swap (redirecting your number to their SIM to ' +
    'catch the codes), so public figures and known Bitcoin holders are prime targets. ' +
    'Prefer app-based TOTP, and hardware security keys (FIDO2), which strongly resist ' +
    'phishing. Save recovery codes offline. 2FA protects accounts (email, exchanges, ' +
    'cloud), but it does nothing for a Bitcoin seed that is already exposed, which is ' +
    'protected by custody, not by login factors.',
  appliesTo: [],
  retrievalHints: ['2FA', 'two-factor', 'TOTP', 'hardware key', 'FIDO2', 'sim swap', 'SMS 2FA', 'double authentification'],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_EFF_SSD],
  stability: 'stable',
};

const FICHE_DISK_ENCRYPTION: Fiche = {
  id: 'FICHE_DISK_ENCRYPTION',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'remediation',
  locale: 'en',
  title: 'Full-disk encryption',
  summary: 'Encrypt devices and backups at rest, so a lost or stolen disk does not hand over your wallet files.',
  body:
    'Full-disk encryption protects data at rest: if a computer, phone or external ' +
    'drive is lost or stolen while locked or powered off, the contents stay ' +
    'unreadable without the passphrase. It does not protect against malware running ' +
    'while the machine is unlocked, so it is a baseline, not a complete defence. ' +
    'Encrypt external drives and backups too if they hold anything sensitive, ' +
    'including wallet files and seed backups. Keep the recovery passphrase safe: lose ' +
    'it and the data is gone. It is a basic measure for journalists, Bitcoiners and ' +
    'anyone handling sensitive data.',
  appliesTo: [],
  retrievalHints: ['full disk encryption', 'FDE', 'device encryption', 'veracrypt', 'data at rest', 'chiffrement du disque'],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_EFF_SSD],
  stability: 'stable',
};

const FICHE_PHISHING: Fiche = {
  id: 'FICHE_PHISHING',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'threat',
  locale: 'en',
  title: 'Phishing and social engineering',
  summary: 'Manipulating you into giving up secrets or payments. Most Bitcoin losses come from this, not broken cryptography.',
  body:
    'Phishing and social engineering manipulate the person rather than the ' +
    'cryptography, and most Bitcoin losses come this way, not from breaking ' +
    'encryption. They exploit urgency, fear, authority, greed or routine, over email, ' +
    'SMS, social media, fake sites, calls or fake support. In Bitcoin they target ' +
    'seeds, passwords, 2FA codes, fake wallet updates and impersonated support. The ' +
    'defences are unique passwords, real 2FA, and checking URLs before you act. The ' +
    'clearest rule: no legitimate support, wallet, or service will ever ask for your ' +
    'seed phrase.',
  appliesTo: [],
  retrievalHints: ['phishing', 'social engineering', 'scam', 'fake support', 'seed phrase scam', 'hameçonnage', 'ingénierie sociale'],
  preconditions: [],
  contraindications: [],
  effort: 'trivial',
  cost: 'none',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [SRC_EFF_SSD],
  stability: 'stable',
};

// ---- Quantum key exposure ----

const FICHE_QUANTUM_EXPOSURE: Fiche = {
  id: 'FICHE_QUANTUM_EXPOSURE',
  version: 1,
  updatedAt: CHECKED,
  reviewedBy: 'explorer',
  kind: 'threat',
  locale: 'en',
  title: 'Quantum key exposure',
  summary: 'A spent-from or Taproot address has its public key on-chain; those coins are the ones a future quantum computer could target first.',
  body:
    'When you spend from a Bitcoin address, its public key is published on-chain ' +
    'forever, and a Taproot output publishes the key immediately. An address that ' +
    'has only ever received, and is not Taproot, keeps its key hidden behind a hash. ' +
    'This matters for one specific, still-hypothetical threat: a large-scale quantum ' +
    'computer could, in theory, derive a private key from an exposed public key. ' +
    'Funds sitting on a key-exposed address are the ones most at risk in that ' +
    'scenario, and reuse makes it worse, since every spend re-exposes the key. There ' +
    'is no urgency today and no machine capable of this exists, but the cheap, ' +
    'forward-looking habit is the same as for privacy: use a fresh address per ' +
    'payment, and for long-term holdings keep funds on never-spent, non-Taproot ' +
    'addresses. Moving coins off an exposed key hides it again.',
  appliesTo: ['QUANTUM_EXPOSURE'],
  retrievalHints: [
    'quantum', 'quantum computing', 'public key exposure', 'shor', 'post-quantum',
    'taproot key', 'exposition quantique', 'clé publique exposée',
  ],
  preconditions: [],
  contraindications: [],
  effort: 'low',
  cost: 'fees_only',
  reversibility: 'reversible',
  legalPosture: 'safe_to_recommend',
  disclaimer: disclaimerFor('safe_to_recommend'),
  sources: [
    { url: 'https://en.bitcoin.it/wiki/Quantum_computing_and_Bitcoin', label: 'Bitcoin Wiki: Quantum computing and Bitcoin', checkedAt: CHECKED },
    { url: 'https://www.bitgo.com/btc-quantum-resistance-score/', label: 'BitGo: BTC Quantum Resistance Score', checkedAt: CHECKED },
  ],
  stability: 'stable',
};

/** Every Fiche in the corpus, in a stable order. */
export const EXPLORER_FICHES: Fiche[] = [
  FICHE_QUANTUM_EXPOSURE,
  FICHE_ADDRESS_REUSE,
  FICHE_COIN_CONTROL,
  FICHE_SILENT_PAYMENTS,
  FICHE_PAYJOIN,
  FICHE_COINJOIN,
  FICHE_COINJOIN_LANDSCAPE,
  FICHE_BIP47_PAYNYM,
  FICHE_TOXIC_CHANGE,
  FICHE_CONSOLIDATION,
  FICHE_CIOH,
  FICHE_TRANSACTION_HEURISTICS,
  FICHE_ANONYMITY_SET,
  FICHE_ENTROPY_ANALYSIS,
  FICHE_CHAIN_ANALYSIS,
  FICHE_CUSTODIAL_MIXER,
  FICHE_KYC_EXPOSURE,
  FICHE_NON_KYC_ACQUISITION,
  FICHE_OWN_NODE,
  FICHE_TOR,
  FICHE_GRAPHENEOS,
  FICHE_VPN,
  FICHE_PASSWORD_MANAGER,
  FICHE_2FA,
  FICHE_DISK_ENCRYPTION,
  FICHE_PHISHING,
];

/** Look a Fiche up by id, for citation and guard evaluation. A retrieved chunk
 *  may carry a locale suffix (`FICHE_X:fr`); strip it back to the source id so a
 *  translated chunk still maps to its guarded Fiche. */
export function getFiche(id: string): Fiche | undefined {
  const baseId = id.replace(/:(?:fr|en)$/, '');
  return EXPLORER_FICHES.find(f => f.id === baseId);
}

export const EXPLORER_PACK_ID = 'explorer-privacy';

/**
 * Build the alice-ai KnowledgePack from the corpus, ready to hand to
 * `registerPack` at the app boundary so the Fiches join the existing RAG. Bundled
 * and enabled by default: the corpus ships with the app, no download.
 *
 * Each Fiche contributes its English source chunk and, when a reviewed French
 * translation exists, a French variant sharing the same conceptId. alice-ai's
 * preferKnowledgeLocale then serves each reader the variant in their language.
 */
export function buildExplorerKnowledgePack(): KnowledgePack {
  const chunks = EXPLORER_FICHES.flatMap(fiche => {
    const source = ficheToKnowledgeChunk(fiche);
    const fr = FICHE_FR[fiche.id];
    return fr
      ? [source, ficheTranslationToChunk(fiche, { locale: 'fr', ...fr })]
      : [source];
  });
  return {
    id: EXPLORER_PACK_ID,
    version: '2',
    language: 'multi',
    source: 'bundled',
    enabledByDefault: true,
    chunks,
  };
}
