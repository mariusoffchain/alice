export type KnowledgeConcept =
  | 'bitcoin-basics'
  | 'bitcoin-cryptography'
  | 'transactions-utxo'
  | 'keys-self-custody'
  | 'mining-proof-of-work'
  | 'bitcoin-economics'
  | 'bitcoin-game-theory'
  | 'lightning-basics'
  | 'lightning-routing'
  | 'privacy'
  | 'scaling-ark'
  | 'scaling-covenants'
  | 'history-philosophy';

export type FamiliarityState = 'unseen' | 'introduced' | 'exploring' | 'familiar';

export type ConceptProgress = {
  signals: number;
  explorationSignals: number;
  lastActiveDay: string | null;
  declaredFamiliarity?: Exclude<FamiliarityState, 'unseen'> | null;
};

export type PedagogicalProfile = {
  version: 3;
  concepts: Partial<Record<KnowledgeConcept, ConceptProgress>>;
  updatedDay: string | null;
};

export type PedagogicalProfileStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
  readLegacy(): Promise<string | null>;
  removeLegacy(): Promise<void>;
};

type ConceptDefinition = {
  id: KnowledgeConcept;
  patterns: RegExp[];
};

const MAX_COUNTER = 10_000;

// This is deliberately a small, maintained knowledge map. A model may map a
// message onto these concepts, but must never invent a lasting category about a
// person from a single conversation.
const CONCEPTS: ConceptDefinition[] = [
  { id: 'bitcoin-basics', patterns: [/\bbitcoin\b/, /\bbtc\b/, /blockchain/, /chaine de blocs/, /cha[iî]ne de blocs/] },
  { id: 'bitcoin-cryptography', patterns: [/cryptograph/, /hash(?:ing)?\b/, /sha-?256/, /signature numerique/, /digital signature/, /secp256k1/] },
  { id: 'transactions-utxo', patterns: [/\butxos?\b/, /transaction/, /txid/, /mempool/, /frais de transaction/, /transaction fee/] },
  { id: 'keys-self-custody', patterns: [/seed phrase/, /phrase de recuperation/, /recovery phrase/, /cle privee/, /private key/, /multisig/, /self[- ]?custody/, /auto[- ]?garde/] },
  { id: 'mining-proof-of-work', patterns: [/proof of work/, /preuve de travail/, /minage/, /mining/, /hashrate/, /asic/, /difficulte/, /difficulty/] },
  { id: 'bitcoin-economics', patterns: [/emission monetaire/, /monetary issuance/, /inflation/, /raret[eé]/, /supply cap/, /21 million/, /politique monetaire/, /monetary policy/] },
  { id: 'bitcoin-game-theory', patterns: [/theorie des jeux/, /game theory/, /incitation/, /incentive/, /attaque des 51/, /51% attack/, /consensus/] },
  { id: 'lightning-basics', patterns: [/lightning/, /\bln\b/, /bolt11/, /bolt12/, /invoice/, /facture lightning/, /channel/, /canal lightning/] },
  { id: 'lightning-routing', patterns: [/routage lightning/, /lightning routing/, /liquidit[eé] lightning/, /channel liquidity/, /htlc/, /watchtower/, /force close/] },
  { id: 'privacy', patterns: [/vie priv[eé]e/, /privacy/, /coinjoin/, /payjoin/, /\bkyc\b/, /anonym/, /reutilisation d.?adresse/, /address reuse/] },
  { id: 'scaling-ark', patterns: [/\bark\b/, /arkade/, /\bvtxo\b/, /\basp\b/] },
  { id: 'scaling-covenants', patterns: [/covenant/, /miniscript/, /taproot/, /tapscript/, /sidechain/, /chaine laterale/, /cha[iî]ne lat[eé]rale/] },
  { id: 'history-philosophy', patterns: [/censure/, /censorship/, /souverainet[eé]/, /philosoph/, /histoire de bitcoin/, /satoshi/, /libert[eé] monetaire/, /monetary freedom/] },
];

const CONCEPT_IDS = new Set<KnowledgeConcept>(CONCEPTS.map(concept => concept.id));

export const KNOWLEDGE_CONCEPT_LABELS: Record<KnowledgeConcept, string> = {
  'bitcoin-basics': 'Bitcoin basics',
  'bitcoin-cryptography': 'Bitcoin cryptography',
  'transactions-utxo': 'Transactions and UTXOs',
  'keys-self-custody': 'Keys and self-custody',
  'mining-proof-of-work': 'Mining and Proof of Work',
  'bitcoin-economics': 'Bitcoin economics',
  'bitcoin-game-theory': 'Bitcoin game theory',
  'lightning-basics': 'Lightning basics',
  'lightning-routing': 'Lightning routing and liquidity',
  privacy: 'Bitcoin privacy',
  'scaling-ark': 'Ark and Arkade',
  'scaling-covenants': 'Covenants and Bitcoin scaling',
  'history-philosophy': 'Bitcoin history and philosophy',
};

function todayLocal(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_COUNTER, Math.floor(value)))
    : 0;
}

function dateOnly(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isKnowledgeConcept(value: unknown): value is KnowledgeConcept {
  return typeof value === 'string' && CONCEPT_IDS.has(value as KnowledgeConcept);
}

function isConceptProgress(value: unknown): value is ConceptProgress {
  if (!value || typeof value !== 'object') return false;
  const progress = value as Record<string, unknown>;
  return typeof progress.signals === 'number'
    && typeof progress.explorationSignals === 'number'
    && (progress.lastActiveDay === null || typeof progress.lastActiveDay === 'string');
}

function emptyProgress(): ConceptProgress {
  return { signals: 0, explorationSignals: 0, lastActiveDay: null, declaredFamiliarity: null };
}

export function createPedagogicalProfile(): PedagogicalProfile {
  return { version: 3, concepts: {}, updatedDay: null };
}

export function isDefinitionQuestion(message: string): boolean {
  const value = normalize(message).replace(/[’'?-]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(qu est ce qu(?:e)?|c est quoi|explique moi|define|what is|what are|tell me about)\b/.test(value);
}

export function inferPedagogicalConcepts(message: string): KnowledgeConcept[] {
  const value = normalize(message);
  return matchingConcepts(value).slice(0, 3);
}

function matchingConcepts(normalizedMessage: string): KnowledgeConcept[] {
  return CONCEPTS
    .filter(concept => concept.patterns.some(pattern => pattern.test(normalizedMessage)))
    .map(concept => concept.id);
}

function isExplorationSignal(message: string): boolean {
  const value = normalize(message);
  return /\b(approfond|plus de detail|details techniques|va plus loin|deeper|more detail|technical detail|go deeper|how exactly|comment fonctionne|how does|architecture|protocole|protocol|tradeoff|compromis|routage|routing|script|timelock)\b/.test(value);
}

export function declaredFamiliarityInMessage(message: string): Exclude<FamiliarityState, 'unseen'> | null {
  const value = normalize(message).replace(/[’']/g, ' ');
  if (/\b(je (?:ne )?(?:connais|comprends|maitrise) pas|je debute|je commence|je suis debutant|je n y connais rien|i (?:do not|don t) (?:know|understand)|i am new to|i m new to|i am a beginner|i m a beginner|i am beginning|i m beginning|i am starting|i m starting)\b/.test(value)) {
    return 'introduced';
  }
  if (/\b(je (?:maitrise|comprends bien|connais bien)|je suis a l aise (?:avec|sur|dans)|mon niveau (?:est )?avance|i (?:master|understand well|know well)|i am comfortable with|i m comfortable with|my level is advanced)\b/.test(value)) {
    return 'familiar';
  }
  if (/\b(j apprends|je suis en train d apprendre|je connais un peu|j explore|niveau intermediaire|i am learning|i m learning|i know a little|i am exploring|i m exploring|intermediate level)\b/.test(value)) {
    return 'exploring';
  }
  return null;
}

export function familiarityFor(progress: ConceptProgress | undefined): FamiliarityState {
  if (!progress || progress.signals === 0) return 'unseen';
  if (progress.declaredFamiliarity) return progress.declaredFamiliarity;
  // Repetition proves interest, not mastery. Only an explicit self-assessment
  // can mark a concept familiar; repeated technical exploration can move an
  // undeclared concept to exploring.
  if (progress.explorationSignals >= 2) return 'exploring';
  return 'introduced';
}

export function updatePedagogicalProfile(profile: PedagogicalProfile, message: string, now = new Date()): PedagogicalProfile {
  const declaredFamiliarity = declaredFamiliarityInMessage(message);
  // Ordinary questions stay bounded to 3 concepts. A direct self-assessment is
  // different: when users list everything they know, keep the complete list.
  const concepts = declaredFamiliarity ? matchingConcepts(normalize(message)) : inferPedagogicalConcepts(message);
  if (concepts.length === 0) return profile;

  const day = todayLocal(now);
  const exploration = isExplorationSignal(message);
  const nextConcepts = { ...profile.concepts };
  for (const concept of concepts) {
    const current = nextConcepts[concept] ?? emptyProgress();
    nextConcepts[concept] = {
      signals: Math.min(MAX_COUNTER, current.signals + 1),
      explorationSignals: Math.min(MAX_COUNTER, current.explorationSignals + (exploration ? 1 : 0)),
      lastActiveDay: day,
      declaredFamiliarity: declaredFamiliarity ?? current.declaredFamiliarity ?? null,
    };
  }
  return { version: 3, concepts: nextConcepts, updatedDay: day };
}

function parseProfile(raw: string | null): PedagogicalProfile | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 3 || !parsed.concepts || typeof parsed.concepts !== 'object') return null;

    const profile = createPedagogicalProfile();
    const concepts = parsed.concepts as Record<string, unknown>;
    for (const [id, value] of Object.entries(concepts)) {
      if (!isKnowledgeConcept(id) || !isConceptProgress(value)) continue;
      const progress = value as Record<string, unknown>;
      profile.concepts[id] = {
        signals: count(progress.signals),
        explorationSignals: count(progress.explorationSignals),
        lastActiveDay: dateOnly(progress.lastActiveDay),
        declaredFamiliarity: progress.declaredFamiliarity === 'introduced'
          || progress.declaredFamiliarity === 'exploring'
          || progress.declaredFamiliarity === 'familiar'
          ? progress.declaredFamiliarity
          : null,
      };
    }
    profile.updatedDay = dateOnly(parsed.updatedDay);
    return profile;
  } catch {
    return null;
  }
}

async function save(storage: PedagogicalProfileStorage, profile: PedagogicalProfile): Promise<PedagogicalProfile> {
  try {
    await storage.write(JSON.stringify(profile));
  } catch {
    // Personalization never interrupts a chat response if secure storage is unavailable.
  }
  return profile;
}

export async function getPedagogicalProfileFromStorage(storage: PedagogicalProfileStorage): Promise<PedagogicalProfile> {
  try {
    const current = parseProfile(await storage.read());
    if (current) return current;

    // Versions 1 and 2 used broad counters and manual user classification.
    // Do not map that imprecise data onto the new knowledge map.
    await storage.removeLegacy();
    return save(storage, createPedagogicalProfile());
  } catch {
    return createPedagogicalProfile();
  }
}

export async function recordPedagogicalSignalInStorage(message: string, storage: PedagogicalProfileStorage): Promise<PedagogicalProfile> {
  return save(storage, updatePedagogicalProfile(await getPedagogicalProfileFromStorage(storage), message));
}

export async function clearPedagogicalProfileFromStorage(storage: PedagogicalProfileStorage): Promise<void> {
  await Promise.all([storage.remove(), storage.removeLegacy()]);
}

export async function forgetPedagogicalConceptInStorage(
  concept: KnowledgeConcept,
  storage: PedagogicalProfileStorage,
): Promise<PedagogicalProfile> {
  const current = await getPedagogicalProfileFromStorage(storage);
  const concepts = { ...current.concepts };
  delete concepts[concept];
  return save(storage, { ...current, concepts });
}

function familiarConcepts(profile: PedagogicalProfile, concepts: KnowledgeConcept[]): KnowledgeConcept[] {
  return concepts.filter(concept => familiarityFor(profile.concepts[concept]) === 'familiar');
}

function exploringConcepts(profile: PedagogicalProfile, concepts: KnowledgeConcept[]): KnowledgeConcept[] {
  return concepts.filter(concept => familiarityFor(profile.concepts[concept]) === 'exploring');
}

export function pedagogicalContext(profile: PedagogicalProfile, message: string, language: 'fr' | 'en' = 'en'): string {
  const concepts = inferPedagogicalConcepts(message);
  const familiar = familiarConcepts(profile, concepts);
  const exploring = exploringConcepts(profile, concepts);
  const declared = concepts.filter(concept => profile.concepts[concept]?.declaredFamiliarity);
  const conceptHint = concepts.length > 0 ? concepts.join(', ') : 'none';

  if (language === 'fr') {
    return [
      "Profil pédagogique privé. Il contient uniquement des repères locaux de familiarité par concept, jamais de données du wallet, d'identité ou de texte des discussions.",
      `Concepts actuels : ${conceptHint}.`,
      declared.length > 0
        ? `L'utilisateur a explicitement déclaré son niveau pour : ${declared.join(', ')}. Cette déclaration fait foi et doit être respectée.`
        : null,
      isDefinitionQuestion(message)
        ? "Il s'agit d'une demande de définition générale. Réponds dans cet ordre : 1 définition simple, 2 idée essentielle, 3 courte ouverture vers 2 ou 3 approfondissements pertinents. N'introduis pas de jargon ou de détails d'implémentation sans les expliquer."
        : familiar.length > 0
          ? `L'utilisateur semble déjà familier avec : ${familiar.join(', ')}. Ne répète pas leurs bases sauf si elles sont nécessaires à la réponse.`
          : exploring.length > 0
            ? `L'utilisateur explore déjà : ${exploring.join(', ')}. Garde une explication claire, puis développe si la question le demande.`
            : "Traite les nouveaux concepts avec prudence. Explique brièvement les termes avant de t'appuyer dessus.",
    ].filter(Boolean).join(' ');
  }

  return [
    'Private pedagogical profile. It contains only local familiarity signals per concept, never wallet data, identity data, or chat text.',
    `Current concepts: ${conceptHint}.`,
    declared.length > 0
      ? `The user explicitly declared their familiarity for: ${declared.join(', ')}. Treat that declaration as authoritative.`
      : null,
    isDefinitionQuestion(message)
      ? 'This is a broad definition request. Answer in this order: 1 plain-language definition, 2 essential idea, 3 one short opening with 2 or 3 relevant directions to explore next. Do not introduce unexplained jargon or implementation details.'
      : familiar.length > 0
        ? `The user appears familiar with: ${familiar.join(', ')}. Do not repeat their basics unless they are needed for the answer.`
        : exploring.length > 0
          ? `The user is already exploring: ${exploring.join(', ')}. Keep the explanation clear, then develop it when the question calls for it.`
          : 'Treat new concepts cautiously. Briefly explain terms before relying on them.',
  ].filter(Boolean).join(' ');
}
