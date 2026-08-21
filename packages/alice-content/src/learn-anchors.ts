// Hand-curated correspondence table between PlanB Academy chapters and the
// Explorer. NEVER generated: every on-chain identifier below was checked
// against the chain via the mempool.space API before being added, and
// scripts/verify-learn-anchors.mjs re-checks them all (an LLM asserting a txid
// from memory is exactly the failure mode this table forbids).
//
// Two directions share this table:
//  - course chapter → Explorer ("See in the Explorer" anchor cards),
//  - Explorer signal → course chapter (ruleId in `concepts` → "Learn more").
//
// Keyed on the corpus' stable chapterIds, so PlanB content updates (Weblate
// retranslations included) never break it and the markdown is never forked.
//
// Every identifier here comes from the corpus itself (the courses link their
// own examples) and was then confirmed against the chain: heights resolved to
// a hash, txids to a confirming block and an output total, addresses to a
// non-empty history. Two classes of candidate were deliberately dropped:
// identifiers the corpus mentions but that are not Bitcoin mainnet objects
// (SHA256 examples, testnet BIP47 transactions, Liquid and Namecoin ids), and
// the block Mike Hearn's chapter names in prose, because the corpus' own link
// there points at a different height (11153 against 11157 in the text).
//
// `match` strings are the corpus' real substrings, extracted from the packs
// rather than typed: French numbers use a non-breaking space where English
// uses an ordinary one, and apostrophes vary, so a hand-written match would
// fail silently. An anchor without a match shows as an end-of-chapter card.

export interface LearnExplorerAnchor {
  type: 'block' | 'tx' | 'address';
  /** Block height (digits), txid, or address, as the Explorer search accepts. */
  id: string;
  label: { fr: string; en: string };
  /**
   * Optional per-language string to highlight inline in the chapter text
   * (first occurrence becomes a clickable link into the Explorer). When the
   * translated text no longer contains it, the end-of-chapter card is the
   * silent fallback, never an error.
   */
  match?: { fr: string; en: string };
  /**
   * Facts scripts/verify-learn-anchors.mjs asserts against mempool.space.
   * A tx anchor records the block that contains it; a block anchor's height is
   * its own check (the API must return a hash for it).
   */
  expect?: { blockHeight?: number; totalOutSats?: number };
}

export interface LearnChapterLink {
  chapterId: string;
  courseCode: string;
  anchors?: LearnExplorerAnchor[];
  /** Explorer RuleIds this chapter explains (drives "Learn more" on signals). */
  concepts?: string[];
}

const GENESIS: LearnExplorerAnchor = {
  type: 'block',
  id: '0',
  label: { fr: 'Le bloc Genesis', en: 'The Genesis block' },
  match: { fr: 'bloc Genesis', en: 'Genesis block' },
  expect: { blockHeight: 0 },
};

const PIZZA_TX: LearnExplorerAnchor = {
  type: 'tx',
  id: 'a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d',
  label: { fr: 'Les 2 pizzas à 10 000 BTC', en: 'The 10,000 BTC pizzas' },
  match: { fr: 'deux pizzas', en: 'two pizzas' },
  expect: { blockHeight: 57043, totalOutSats: 1000000000000 },
};

const FIRST_P2P_TX: LearnExplorerAnchor = {
  type: 'tx',
  id: 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16',
  label: { fr: 'La première transaction (bloc 170)', en: 'The first transaction (block 170)' },
  expect: { blockHeight: 170, totalOutSats: 5000000000 },
};

const FIRST_HALVING: LearnExplorerAnchor = {
  type: 'block',
  id: '210000',
  label: { fr: 'Le premier halving', en: 'The first halving' },
  match: { fr: 'halving', en: 'halving' },
  expect: { blockHeight: 210000 },
};

const HALVING_2024: LearnExplorerAnchor = {
  type: 'block',
  id: '840000',
  label: { fr: 'Le halving de 2024', en: 'The 2024 halving' },
  expect: { blockHeight: 840000 },
};

const FINNEY_FIRST_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '78',
  label: { fr: 'Le premier bloc miné par Hal Finney', en: 'Hal Finney’s first mined block' },
  match: { fr: 'bloc 78', en: 'block 78' },
  expect: { blockHeight: 78 },
};

const TRAMMELL_FIRST_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '309',
  label: { fr: 'Le premier bloc de Dustin Trammell', en: 'Dustin Trammell’s first block' },
  expect: { blockHeight: 309 },
};

const SATOSHI_TO_TRAMMELL: LearnExplorerAnchor = {
  type: 'tx',
  id: 'd71fd2f64c0b34465b7518d240c00e83f6a5b10138a7079d1252858fe7e6b577',
  label: { fr: 'Les 50 bitcoins envoyés à Dustin Trammell', en: 'The 50 bitcoins sent to Dustin Trammell' },
  expect: { blockHeight: 524, totalOutSats: 5000000000 },
};

const MALMI_FIRST_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '10351',
  label: { fr: 'Le premier bloc de Martti Malmi', en: 'Martti Malmi’s first block' },
  match: { fr: 'bloc 10 351', en: 'block 10,351' },
  expect: { blockHeight: 10351 },
};

const NLS_FIRST_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '23940',
  label: { fr: 'Le premier bloc de NewLibertyStandard', en: 'NewLibertyStandard’s first block' },
  match: { fr: 'bloc 23 940', en: 'block 23,940' },
  expect: { blockHeight: 23940 },
};

const FIRST_SALE: LearnExplorerAnchor = {
  type: 'tx',
  id: '67fc73c770d5001be14f65c95f2f37e04e26c3f8c6a49519d2e63c594ea26756',
  label: { fr: 'La première vente de bitcoins (22 500 BTC)', en: 'The first sale of bitcoins (22,500 BTC)' },
  expect: { blockHeight: 27528, totalOutSats: 2250000000000 },
};

const FIRST_POKER_GAME: LearnExplorerAnchor = {
  type: 'tx',
  id: '6477a88f0196e1fcf6c608e446be62c708556f34a79d169fbb05b1fee92f5761',
  label: { fr: 'Les 600 BTC de la première partie de poker', en: 'The 600 BTC of the first poker game' },
  match: { fr: '600 BTC', en: '600 BTC' },
  expect: { blockHeight: 46161, totalOutSats: 60000000000 },
};

const TRAMMELL_ADDRESS: LearnExplorerAnchor = {
  type: 'address',
  id: '12higDjoCCNXSA95xZMWUdPvXNmkAduhWv',
  label: { fr: 'L’adresse de minage de Dustin Trammell', en: 'Dustin Trammell’s mining address' },
};

const HOWELLS_ADDRESS: LearnExplorerAnchor = {
  type: 'address',
  id: '198aMn6ZYAczwrE5NvNTUMyJ5qkfy4g3Hi',
  label: { fr: 'Les 8 000 BTC du disque dur perdu', en: 'The 8,000 BTC of the lost hard drive' },
  match: { fr: 'génère', en: 'generates' },
};

const LASZLO_ADDRESS: LearnExplorerAnchor = {
  type: 'address',
  id: '1XPTgDRhN8RFnzniWCddobD9iKZatrvH4',
  label: { fr: 'L’adresse publique de Laszlo Hanyecz', en: 'Laszlo Hanyecz’s public address' },
  match: { fr: 'adresse publique', en: 'public address' },
};

const LASZLO_BUYS_BTC: LearnExplorerAnchor = {
  type: 'tx',
  id: 'faf172f5dc06b0ae03268555dddcd65be47e9a8a8bb44a122b12bfaf735f9a81',
  label: { fr: 'Les 3 300 bitcoins achetés par Laszlo', en: 'The 3,300 bitcoins Laszlo bought' },
  expect: { blockHeight: 49821, totalOutSats: 332227000000 },
};

const SATOSHI_LAST_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '54316',
  label: { fr: 'Le dernier bloc miné par Satoshi', en: 'Satoshi’s last mined block' },
  match: { fr: 'bloc 54 316', en: 'block 54,316' },
  expect: { blockHeight: 54316 },
};

const FIRST_BOUNTY: LearnExplorerAnchor = {
  type: 'tx',
  id: 'f79314da84567196905f6e061e2bc9f3ee8b30d40f7b80dac90fcb1f4b4c71ea',
  label: { fr: 'La première prime payée en bitcoins', en: 'The first bounty paid in bitcoins' },
  expect: { blockHeight: 80591, totalOutSats: 1005000000000 },
};

const EFF_DONATIONS: LearnExplorerAnchor = {
  type: 'tx',
  id: '8ca2d206bc41b9ffa36cf4ea9ce9d3b0751fd653b6ec8f2979bfdddc4a631731',
  label: { fr: 'Les premiers dons en bitcoins à l’EFF', en: 'The first bitcoin donations to the EFF' },
  expect: { blockHeight: 90696, totalOutSats: 5000000000 },
};

const EFF_ADDRESS: LearnExplorerAnchor = {
  type: 'address',
  id: '1MCwBbhNGp5hRm5rC1Aims2YFRe2SXPYKt',
  label: { fr: 'L’adresse de collecte pour l’EFF', en: 'The EFF fundraising address' },
};

const OVERFLOW_REPLACEMENT: LearnExplorerAnchor = {
  type: 'block',
  id: '74638',
  label: { fr: 'Le bloc qui a remplacé celui du débordement', en: 'The block that replaced the overflow one' },
  match: { fr: 'premier bloc', en: 'first block' },
  expect: { blockHeight: 74638 },
};

const MAX_BLOCK_SIZE_ACTIVATION: LearnExplorerAnchor = {
  type: 'block',
  id: '79400',
  label: { fr: 'L’entrée en vigueur de la limite de 1 Mo', en: 'The 1 MB limit taking effect' },
  match: { fr: 'bloc 79 400', en: 'block 79,400' },
  expect: { blockHeight: 79400 },
};

const MTGOX_THEFT: LearnExplorerAnchor = {
  type: 'tx',
  id: 'e67a0550848b7932d7796aeea16ab0e48a5cfe81c4e8cca2c5b03e0416850114',
  label: { fr: 'Les 80 000 BTC volés à Mt. Gox', en: 'The 80,000 BTC stolen from Mt. Gox' },
  match: { fr: 's\'évaporent', en: 'evaporated' },
  expect: { blockHeight: 111194, totalOutSats: 7995655000000 },
};

const ALLINVAIN_THEFT: LearnExplorerAnchor = {
  type: 'tx',
  id: '4885ddf124a0f97b5a3775a12de0274d342d12842ebe59520359f976721ac8c3',
  label: { fr: 'Les 25 000 BTC dérobés à Allinvain', en: 'The 25,000 BTC stolen from Allinvain' },
  match: { fr: 'se fait dérober', en: 'was robbed' },
  expect: { blockHeight: 130560, totalOutSats: 2500001000000 },
};

const CLEARCOIN_ESCROW: LearnExplorerAnchor = {
  type: 'tx',
  id: 'b95fb3675d580fea982c02adbffae4224606470ce3f5e6685c3977da337d52f1',
  label: { fr: 'La libération du séquestre ClearCoin', en: 'The ClearCoin escrow release' },
  match: { fr: 'libérés', en: 'released' },
  expect: { blockHeight: 137469, totalOutSats: 79052710000 },
};

const KEENE_LUNCH: LearnExplorerAnchor = {
  type: 'tx',
  id: '8dc70b8e15632becb2a070ea1ad01f292486487c5d97671535c2732e2c9131fb',
  label: { fr: 'Les 25 BTC du déjeuner de Keene', en: 'The 25 BTC of the Keene lunch' },
  match: { fr: 'envoyant', en: 'sending' },
  expect: { blockHeight: 108305, totalOutSats: 5000000000 },
};

const ELIGIUS_SIGNED_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '130635',
  label: { fr: 'Le premier bloc signé /Eligius/', en: 'The first block signed /Eligius/' },
  match: { fr: '130 635', en: '130 635' },
  expect: { blockHeight: 130635 },
};

const RICKROLL_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '142573',
  label: { fr: 'Le bloc rickroll d’Eligius', en: 'Eligius’ rickroll block' },
  match: { fr: 'rickroll', en: 'rickroll' },
  expect: { blockHeight: 142573 },
};

const SLUSH_SIGNED_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '163970',
  label: { fr: 'Le premier bloc signé /slush/', en: 'The first block signed /slush/' },
  expect: { blockHeight: 163970 },
};

const COINBASE_INSULT_TX: LearnExplorerAnchor = {
  type: 'tx',
  id: '9740e7d646f5278603c04706a366716e5e87212c57395e0d24761c0ae784b2c6',
  label: { fr: 'Le message gravé dans une transaction', en: 'The message engraved in a transaction' },
  expect: { blockHeight: 141460, totalOutSats: 100000 },
};

const DUPLICATE_COINBASE_1: LearnExplorerAnchor = {
  type: 'block',
  id: '91722',
  label: { fr: 'Le bloc 91 722 et sa coinbase dupliquée', en: 'Block 91,722 and its duplicate coinbase' },
  match: { fr: '91 722', en: '91 722' },
  expect: { blockHeight: 91722 },
};

const DUPLICATE_COINBASE_2: LearnExplorerAnchor = {
  type: 'block',
  id: '91812',
  label: { fr: 'Le bloc 91 812 et sa coinbase dupliquée', en: 'Block 91,812 and its duplicate coinbase' },
  match: { fr: '91 812', en: '91 812' },
  expect: { blockHeight: 91812 },
};

const DUPLICATE_COINBASE_3: LearnExplorerAnchor = {
  type: 'block',
  id: '91842',
  label: { fr: 'Le bloc 91 842, copie du 91 812', en: 'Block 91,842, a copy of 91,812' },
  match: { fr: '91 842', en: '91 842' },
  expect: { blockHeight: 91842 },
};

const DUPLICATE_COINBASE_4: LearnExplorerAnchor = {
  type: 'block',
  id: '91880',
  label: { fr: 'Le bloc 91 880, copie du 91 722', en: 'Block 91,880, a copy of 91,722' },
  match: { fr: '91 880', en: '91 880' },
  expect: { blockHeight: 91880 },
};

const SATOSHIDICE_COMMITMENT: LearnExplorerAnchor = {
  type: 'tx',
  id: '428bcc630b00fe431623b4e1fb0f726493dc0a2ead86ace9f65cd51bc8092459',
  label: { fr: 'Des secrets de jeu inscrits dans la chaîne', en: 'Gambling secrets written into the chain' },
  match: { fr: 'stockés', en: 'stored' },
  expect: { blockHeight: 176161, totalOutSats: 1527809 },
};

const MTGOX_BIGGEST_UTXO: LearnExplorerAnchor = {
  type: 'tx',
  id: '29a3efd3ef04f9153d47a990bd7b048a4b2d213daaa5fb8ed670fb85f13bdbcf',
  label: { fr: 'Le plus grand UTXO jamais créé', en: 'The largest UTXO ever created' },
  match: { fr: '29a3efd3ef04f9153d47a990bd7b048a4b2d213daaa5fb8ed670fb85f13bdbcf', en: '29a3efd3ef04f9153d47a990bd7b048a4b2d213daaa5fb8ed670fb85f13bdbcf' },
  expect: { blockHeight: 153509, totalOutSats: 55000000000000 },
};

const PATTERN_SIMPLE_SEND: LearnExplorerAnchor = {
  type: 'tx',
  id: 'b6cc79f45fd2d7669ff94db5cb14c45f1f879ea0ba4c6e3d16ad53a18c34b769',
  label: { fr: 'Le pattern de l’envoi simple', en: 'The simple send pattern' },
  expect: { blockHeight: 777500, totalOutSats: 241457 },
};

const PATTERN_SWEEP: LearnExplorerAnchor = {
  type: 'tx',
  id: '35f1072a0fda5ae106efb4fda871ab40e1f8023c6c47f396441ad4b995ea693d',
  label: { fr: 'Le pattern du balayage', en: 'The sweep pattern' },
  expect: { blockHeight: 808468, totalOutSats: 3161175 },
};

const PATTERN_CONSOLIDATION: LearnExplorerAnchor = {
  type: 'tx',
  id: '77c16914211e237a9bd51a7ce0b1a7368631caed515fe51b081d220590589e94',
  label: { fr: 'Le pattern de la consolidation', en: 'The consolidation pattern' },
  expect: { blockHeight: 777500, totalOutSats: 1103965 },
};

const PATTERN_BATCHED: LearnExplorerAnchor = {
  type: 'tx',
  id: '8a7288758b6e5d550897beedd13c70bcbaba8709af01a7dbcc1f574b89176b43',
  label: { fr: 'Le pattern de la dépense groupée', en: 'The batched spending pattern' },
  expect: { blockHeight: 777500, totalOutSats: 2927564695 },
};

const PATTERN_COINJOIN: LearnExplorerAnchor = {
  type: 'tx',
  id: '00601af905bede31086d9b1b79ee8399bd60c97e9c5bba197bdebeee028b9bea',
  label: { fr: 'Le pattern du coinjoin', en: 'The coinjoin pattern' },
  expect: { blockHeight: 667699, totalOutSats: 5000000 },
};

const HEURISTIC_ADDRESS_CHANGE: LearnExplorerAnchor = {
  type: 'tx',
  id: '54364146665bfc453a55eae4bfb8fdf7c721d02cb96aadc480c8b16bdeb8d6d0',
  label: { fr: 'Le change trahi par une adresse réutilisée', en: 'Change betrayed by a reused address' },
  expect: { blockHeight: 777500, totalOutSats: 945394843 },
};

const HEURISTIC_SCRIPT_TYPE: LearnExplorerAnchor = {
  type: 'tx',
  id: 'db07516288771ce5d0a06b275962ec4af1b74500739f168e5800cbcb0e9dd578',
  label: { fr: 'Le change trahi par le type de script', en: 'Change betrayed by the script type' },
  expect: { blockHeight: 777813, totalOutSats: 1575180 },
};

const HEURISTIC_ROUND_AMOUNT: LearnExplorerAnchor = {
  type: 'tx',
  id: '2bcb42fab7fba17ac1b176060e7d7d7730a7b807d470815f5034d52e96d2828a',
  label: { fr: 'Le paiement au montant rond', en: 'The round-amount payment' },
  expect: { blockHeight: 777813, totalOutSats: 926539 },
};

const HEURISTIC_LARGEST_OUTPUT: LearnExplorerAnchor = {
  type: 'tx',
  id: 'b79d8f8e4756d34bbb26c659ab88314c220834c7a8b781c047a3916b56d14dcf',
  label: { fr: 'La plus grande sortie comme indice', en: 'The largest output as a clue' },
  expect: { blockHeight: 777500, totalOutSats: 23316825 },
};

const CIOH_EXAMPLE: LearnExplorerAnchor = {
  type: 'tx',
  id: '20618e63b6eed056263fa52a2282c8897ab2ee71604c7faccfe748e1a202d712',
  label: { fr: 'Une transaction où la CIOH s’applique', en: 'A transaction where the CIOH applies' },
  expect: { blockHeight: 844602, totalOutSats: 84893288 },
};

const FEE_MISTAKE_19_BTC: LearnExplorerAnchor = {
  type: 'tx',
  id: 'd5392d474b4c436e1c9d1f4ff4be5f5f9bb0eb2e26b61d2781751474b7e870fd',
  label: { fr: 'Les 19 BTC de frais payés par erreur', en: 'The 19 BTC fee paid by mistake' },
  match: { fr: 'la transaction qui avait par erreur alloué 19 bitcoins de frais', en: 'the transaction that had mistakenly allocated 19 bitcoins in fees' },
  expect: { blockHeight: 807057, totalOutSats: 7405440 },
};

const REUSED_ADDRESS_EXAMPLE: LearnExplorerAnchor = {
  type: 'address',
  id: 'bc1qqtmeu0eyvem9a85l3sghuhral8tk0ar7m4a0a0',
  label: { fr: 'Une adresse réutilisée sur 22 transactions', en: 'An address reused across 22 transactions' },
};

const WHIRLPOOL_TX0: LearnExplorerAnchor = {
  type: 'tx',
  id: 'edef60744f539483d868caff49d4848e5cc6e805d6cdc8d0f9bdbbaedcb5fc46',
  label: { fr: 'Une vraie Tx0 Whirlpool', en: 'A real Whirlpool Tx0' },
  match: { fr: 'edef60744f539483d868caff49d4848e5cc6e805d6cdc8d0f9bdbbaedcb5fc46', en: 'edef60744f539483d868caff49d4848e5cc6e805d6cdc8d0f9bdbbaedcb5fc46' },
  expect: { blockHeight: 784330, totalOutSats: 986329 },
};

const ENTROPY_EXAMPLE: LearnExplorerAnchor = {
  type: 'tx',
  id: '1b1b0c3f0883a99f1161c64da19471841ed12a1f78e77fab128c69a5f578ccce',
  label: { fr: 'Un paiement à 1 entrée et 2 sorties', en: 'A payment with 1 input and 2 outputs' },
  match: { fr: '1b1b0c3f0883a99f1161c64da19471841ed12a1f78e77fab128c69a5f578ccce', en: '1b1b0c3f0883a99f1161c64da19471841ed12a1f78e77fab128c69a5f578ccce' },
  expect: { blockHeight: 830748, totalOutSats: 456556 },
};

const EXERCISE_1: LearnExplorerAnchor = {
  type: 'tx',
  id: '3769d3b124e47ef4ffb5b52d11df64b0a3f0b82bb10fd6b98c0fd5111789bef7',
  label: { fr: 'Exercice 1', en: 'Exercise 1' },
  expect: { blockHeight: 689541, totalOutSats: 1904782 },
};

const EXERCISE_2: LearnExplorerAnchor = {
  type: 'tx',
  id: 'baa228f6859ca63e6b8eea24ffad7e871713749d693ebd85343859173b8d5c20',
  label: { fr: 'Exercice 2', en: 'Exercise 2' },
  expect: { blockHeight: 689541, totalOutSats: 60676625 },
};

const EXERCISE_3: LearnExplorerAnchor = {
  type: 'tx',
  id: '3a9eb9ccc3517cc25d1860924c66109262a4b68f4ed2d847f079b084da0cd32b',
  label: { fr: 'Exercice 3', en: 'Exercise 3' },
  expect: { blockHeight: 701452, totalOutSats: 629528 },
};

const EXERCISE_4: LearnExplorerAnchor = {
  type: 'tx',
  id: '35f0b31c05503ebfdf7311df47f68a048e992e5cf4c97ec34aa2833cc0122a12',
  label: { fr: 'Exercice 4', en: 'Exercise 4' },
  expect: { blockHeight: 695125, totalOutSats: 92962 },
};

const EXERCISE_5_ADDRESS: LearnExplorerAnchor = {
  type: 'address',
  id: 'bc1qja0hycrv7g9ww00jcqanhfpqmzx7luqalum3vu',
  label: { fr: 'Exercice 5 : l’adresse publiée', en: 'Exercise 5: the published address' },
};

const EXERCISE_6: LearnExplorerAnchor = {
  type: 'tx',
  id: '2d9575553c99578268ffba49a1b2adc3b85a29926728bd0280703a04d051eace',
  label: { fr: 'Exercice 6', en: 'Exercise 6' },
  expect: { blockHeight: 736259, totalOutSats: 489285049 },
};

const EXERCISE_8: LearnExplorerAnchor = {
  type: 'tx',
  id: 'bb346dae645d09d32ed6eca1391d2ee97c57e11b4c31ae4325bcffdec40afd4f',
  label: { fr: 'Exercice 8', en: 'Exercise 8' },
  expect: { blockHeight: 745941, totalOutSats: 938983 },
};

const TAPROOT_ACTIVATION: LearnExplorerAnchor = {
  type: 'block',
  id: '709632',
  label: { fr: 'L’activation de Taproot', en: 'The Taproot activation' },
  match: { fr: '709632', en: '709632' },
  expect: { blockHeight: 709632 },
};

const REORG_LAST_VALID_BLOCK: LearnExplorerAnchor = {
  type: 'block',
  id: '74637',
  label: { fr: 'Le dernier bloc avant la réorganisation de 2010', en: 'The last block before the 2010 reorg' },
  match: { fr: '74637', en: '74637' },
  expect: { blockHeight: 74637 },
};

const REORG_OVERTAKEN: LearnExplorerAnchor = {
  type: 'block',
  id: '74689',
  label: { fr: 'Là où la nouvelle chaîne a dépassé l’ancienne', en: 'Where the new chain overtook the old one' },
  match: { fr: 'bloc 74689', en: 'block 74689' },
  expect: { blockHeight: 74689 },
};

const BDB_FORK: LearnExplorerAnchor = {
  type: 'block',
  id: '225429',
  label: { fr: 'La scission de mars 2013', en: 'The March 2013 split' },
  match: { fr: 'bloc 225429', en: 'block 225429' },
  expect: { blockHeight: 225429 },
};

const BIP66_SPLIT: LearnExplorerAnchor = {
  type: 'block',
  id: '363730',
  label: { fr: 'La scission BIP66 de 2015', en: 'The 2015 BIP66 split' },
  match: { fr: '363730', en: '363730' },
  expect: { blockHeight: 363730 },
};

const BIP34_ACTIVATION: LearnExplorerAnchor = {
  type: 'block',
  id: '227930',
  label: { fr: 'L’activation de BIP-34 (hauteur dans la coinbase)', en: 'The BIP-34 activation (height in the coinbase)' },
  match: { fr: 'bloc 227 930', en: 'block 227,930' },
  expect: { blockHeight: 227930 },
};

const HALVING_2016: LearnExplorerAnchor = {
  type: 'block',
  id: '420000',
  label: { fr: 'Le halving de 2016', en: 'The 2016 halving' },
  expect: { blockHeight: 420000 },
};

const HALVING_2020: LearnExplorerAnchor = {
  type: 'block',
  id: '630000',
  label: { fr: 'Le halving de 2020', en: 'The 2020 halving' },
  expect: { blockHeight: 630000 },
};

/**
 * Chat-side matching: distinctive keywords that map a user question to an
 * anchor worth showing under Alice's reply ("Pour aller plus loin"). Tokens
 * are compared lowercase, accent-free and plural-stripped; one hit suffices,
 * so ONLY words that unambiguously designate the subject belong here (never
 * "bitcoin" or "transaction"). Hand-curated like everything else in this file.
 */
export interface ChatAnchorSuggestion {
  anchor: LearnExplorerAnchor;
  keywords: string[];
}

export const CHAT_EXPLORER_SUGGESTIONS: ChatAnchorSuggestion[] = [
  { anchor: GENESIS, keywords: ['genesis'] },
  { anchor: PIZZA_TX, keywords: ['pizza'] },
  { anchor: FIRST_P2P_TX, keywords: ['finney'] },
  // One anchor per subject: for "halving", the 2024 one is the most relatable.
  { anchor: HALVING_2024, keywords: ['halving'] },
];

export const LEARN_CHAPTER_LINKS: LearnChapterLink[] = [
  // ----------------------------------------------------- btc101 ---
  {
    // « Lancement de Bitcoin »
    chapterId: 'b7561082-8943-519d-95d1-a5f60dd2686d',
    courseCode: 'btc101',
    anchors: [GENESIS, FIRST_P2P_TX, PIZZA_TX],
  },
  {
    // « 21 millions de bitcoins »
    chapterId: 'f4a06d76-1963-56fd-93ff-dfa41489bcde',
    courseCode: 'btc101',
    anchors: [FIRST_HALVING, HALVING_2024],
  },
  {
    // « Mineurs »
    chapterId: 'dbb8264a-7434-57e4-9d1b-fbd1bae37fdf',
    courseCode: 'btc101',
    anchors: [FIRST_HALVING, HALVING_2016, HALVING_2020, HALVING_2024],
  },
  // ----------------------------------------------------- btc102 ---
  {
    // « Bitcoin en 5 minutes »
    chapterId: 'ae122ad9-9b4d-5229-9038-e1b99d5cfc83',
    courseCode: 'btc102',
    anchors: [GENESIS, FIRST_HALVING],
  },
  {
    // « Le Paranoïaque : protéger sa vie privée »
    chapterId: '5c624acd-662e-5134-ab7a-fb75cde7c3f8',
    courseCode: 'btc102',
    concepts: ['ADDRESS_REUSE', 'COINJOIN', 'ENTITY_LINK'],
  },
  // ----------------------------------------------------- btc204 ---
  {
    // « La réutilisation d'adresse »
    chapterId: 'f3e97645-3df3-41bc-a4ed-d2c740113d96',
    courseCode: 'btc204',
    anchors: [REUSED_ADDRESS_EXAMPLE],
    concepts: ['ADDRESS_REUSE'],
  },
  {
    // « Le modèle d'UTXO de Bitcoin »
    chapterId: '8d6b50c5-bf74-44f4-922b-25204991cb75',
    courseCode: 'btc204',
    anchors: [MTGOX_BIGGEST_UTXO],
  },
  {
    // « Les patterns de transactions »
    chapterId: 'd365a101-2d37-46a5-bfb9-3c51e37bf96b',
    courseCode: 'btc204',
    anchors: [PATTERN_SIMPLE_SEND, PATTERN_SWEEP, PATTERN_CONSOLIDATION, PATTERN_BATCHED, PATTERN_COINJOIN],
    concepts: ['PEEL_CHAIN'],
  },
  {
    // « Les heuristiques internes »
    chapterId: 'c54b5abe-872f-40f4-a0d0-c59faff228ba',
    courseCode: 'btc204',
    anchors: [HEURISTIC_ADDRESS_CHANGE, HEURISTIC_SCRIPT_TYPE, HEURISTIC_ROUND_AMOUNT, HEURISTIC_LARGEST_OUTPUT],
    concepts: ['CHANGE_DETECTION', 'WALLET_FINGERPRINT', 'SCRIPT_TYPE_MIX', 'ROUND_AMOUNT'],
  },
  {
    // « Les heuristiques externes »
    chapterId: '4a170e3b-200d-431a-8285-18a23ff617ba',
    courseCode: 'btc204',
    anchors: [CIOH_EXAMPLE, FEE_MISTAKE_19_BTC],
    concepts: ['ENTITY_LINK'],
  },
  {
    // « C'est quoi l'analyse de chaîne sur Bitcoin ? »
    chapterId: '7d198ba6-4af2-4f24-86cb-3c79cb25627e',
    courseCode: 'btc204',
    concepts: ['DUST_OUTPUT', 'DUST_SPENDING'],
  },
  {
    // « La consolidation, la gestion des UTXOs et la CIOH »
    chapterId: 'd0486c8f-332d-402b-ae2e-949416752b9c',
    courseCode: 'btc204',
    concepts: ['CIOH', 'CONSOLIDATION'],
  },
  {
    // « C'est quoi une transaction coinjoin ? »
    chapterId: '0862bc6b-1c48-4aa4-b76d-4f547b469008',
    courseCode: 'btc204',
    concepts: ['COINJOIN'],
  },
  {
    // « Le fonctionnement de Whirlpool »
    chapterId: 'bdbd7109-e36d-4b4f-a3c6-928df4e9bfda',
    courseCode: 'btc204',
    anchors: [WHIRLPOOL_TX0],
    concepts: ['PREMIX', 'POSTMIX'],
  },
  {
    // « Les ensembles d'anonymat »
    chapterId: 'be1093dc-1a74-40e5-9545-2b97a7d7d431',
    courseCode: 'btc204',
    concepts: ['ANONYMITY_SET'],
  },
  {
    // « L'entropie »
    chapterId: 'e4fe289d-618b-49a2-84c9-68c562e708b4',
    courseCode: 'btc204',
    anchors: [ENTROPY_EXAMPLE],
    concepts: ['ENTROPY'],
  },
  {
    // « Mise en pratique avec un explorateur de blocs »
    chapterId: '6493cf2f-225c-405f-9375-c4304f1087ed',
    courseCode: 'btc204',
    anchors: [EXERCISE_1, EXERCISE_2, EXERCISE_3, EXERCISE_4, EXERCISE_5_ADDRESS, EXERCISE_6, EXERCISE_8],
  },
  // ----------------------------------------------------- btc303 ---
  {
    // « Mise à jour »
    chapterId: '3ffa84d1-adfa-5fbc-9b13-384ea783fcdd',
    courseCode: 'btc303',
    anchors: [TAPROOT_ACTIVATION],
  },
  {
    // « Quand tout dérape »
    chapterId: 'fe39c13c-310f-51fd-84ff-6b92dd01c9e7',
    courseCode: 'btc303',
    anchors: [REORG_LAST_VALID_BLOCK, REORG_OVERTAKEN, BDB_FORK, BIP66_SPLIT],
  },
  {
    // « Vie privée »
    chapterId: '1b960afe-0008-589b-b2f4-007d60d264c6',
    courseCode: 'btc303',
    concepts: ['ADDRESS_REUSE', 'CIOH', 'ENTITY_LINK', 'COINJOIN'],
  },
  // ----------------------------------------------------- min101 ---
  {
    // « Le halving »
    chapterId: '7cdca211-7300-48f8-a1e4-53e5c2678cd8',
    courseCode: 'min101',
    anchors: [FIRST_HALVING, HALVING_2016, HALVING_2020, HALVING_2024],
  },
  {
    // « La transaction coinbase »
    chapterId: '69476700-3616-4aab-b006-367aba059de9',
    courseCode: 'min101',
    anchors: [GENESIS, BIP34_ACTIVATION],
  },
  // ----------------------------------------------------- his201 ---
  {
    // « La naissance de Bitcoin »
    chapterId: '3d141918-e9c2-46e8-8c03-2bb4eb9b2150',
    courseCode: 'his201',
    anchors: [FINNEY_FIRST_BLOCK, FIRST_P2P_TX, TRAMMELL_FIRST_BLOCK, SATOSHI_TO_TRAMMELL],
  },
  {
    // « La présentation au monde »
    chapterId: '28be3515-d9da-4d91-b7ff-f8691d51c562',
    courseCode: 'his201',
    anchors: [MALMI_FIRST_BLOCK],
  },
  {
    // « L'amorçage de la cryptomonnaie »
    chapterId: '6b3418a7-125e-4ea1-a03a-f36090fac8a4',
    courseCode: 'his201',
    anchors: [TRAMMELL_ADDRESS, HOWELLS_ADDRESS, NLS_FIRST_BLOCK, FIRST_SALE, FIRST_POKER_GAME],
  },
  {
    // « Cartes graphiques, pizzas et bitcoins gratuits »
    chapterId: '9cd228a4-58d3-46a3-9935-06098bafc954',
    courseCode: 'his201',
    anchors: [LASZLO_BUYS_BTC, LASZLO_ADDRESS, SATOSHI_LAST_BLOCK, PIZZA_TX],
  },
  {
    // « Les premiers ennuis techniques »
    chapterId: '30cc4fe4-22b0-429e-9874-029c9137c0aa',
    courseCode: 'his201',
    anchors: [OVERFLOW_REPLACEMENT, MAX_BLOCK_SIZE_ACTIVATION],
  },
  {
    // « La ruée vers l'or numérique »
    chapterId: '8e9899ca-e7a7-471b-8e69-847a56714d3b',
    courseCode: 'his201',
    anchors: [FIRST_BOUNTY],
  },
  {
    // « La floraison de l'écosystème »
    chapterId: '0404f877-8b5c-4c7f-81ab-a4e6d9b3da9c',
    courseCode: 'his201',
    anchors: [EFF_ADDRESS, EFF_DONATIONS],
  },
  // ----------------------------------------------------- his203 ---
  {
    // « La reprise de Mt. Gox »
    chapterId: '451293d5-d691-5c36-91dd-4ee5e6dcc9e3',
    courseCode: 'his203',
    anchors: [MTGOX_THEFT, ALLINVAIN_THEFT, CLEARCOIN_ESCROW],
  },
  {
    // « L'essor des coopératives de minage »
    chapterId: '7bd97db9-1c72-53f1-800f-6cee80f57908',
    courseCode: 'his203',
    anchors: [ELIGIUS_SIGNED_BLOCK, COINBASE_INSULT_TX, RICKROLL_BLOCK, SLUSH_SIGNED_BLOCK],
  },
  {
    // « La bataille pour Pay to Script Hash »
    chapterId: '6f6fba00-f9a5-59c7-b780-602127b85fd6',
    courseCode: 'his203',
    anchors: [DUPLICATE_COINBASE_1, DUPLICATE_COINBASE_2, DUPLICATE_COINBASE_3, DUPLICATE_COINBASE_4],
  },
  {
    // « Bitcoin et l'activisme politique »
    chapterId: '5545c513-74de-57e8-929e-a75406ed5829',
    courseCode: 'his203',
    anchors: [KEENE_LUNCH],
  },
  {
    // « La monnaie du vice : jeu d'argent et travail du sexe »
    chapterId: '4355fe11-f6d7-5b8b-bbf0-838af9de25b2',
    courseCode: 'his203',
    anchors: [SATOSHIDICE_COMMITMENT],
  },
  {
    // « L'amélioration de l'utilisation de Bitcoin »
    chapterId: 'e73d02f8-c1cb-562b-ac80-8a6a672599fd',
    courseCode: 'his203',
    concepts: ['COINJOIN'],
  },
  // ----------------------------------------------------- cyp201 ---
  {
    // « Évolution des portefeuilles Bitcoin »
    chapterId: '9d9acd5d-a0e5-5dfd-b544-f043fae8840f',
    courseCode: 'cyp201',
    concepts: ['ADDRESS_REUSE'],
  },
  // ----------------------------------------------------- pro101 ---
  {
    // « Comprendre Joinmarket »
    chapterId: 'f109f64f-9b73-5fbf-8870-5d34d5b69df8',
    courseCode: 'pro101',
    concepts: ['COINJOIN'],
  },
];

export function anchorsForChapter(chapterId: string): LearnExplorerAnchor[] {
  return LEARN_CHAPTER_LINKS.find((link) => link.chapterId === chapterId)?.anchors ?? [];
}

/** Chapters explaining a given Explorer rule, in table order. */
export function chaptersForConcept(ruleId: string): LearnChapterLink[] {
  return LEARN_CHAPTER_LINKS.filter((link) => link.concepts?.includes(ruleId));
}
