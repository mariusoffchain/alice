import { detectSensitiveInput } from './ai-sensitive-input.ts';
import type { SupportedLanguage } from './language-policy.ts';

export type AliceMemoryCategory =
  | 'preference'
  | 'setup'
  | 'experience'
  | 'goal'
  | 'project'
  | 'interest'
  | 'background'
  | 'constraint'
  | 'requested-note';

export type AliceMemoryCandidate = {
  category: AliceMemoryCategory;
  text: string;
};

export type AliceMemoryItem = AliceMemoryCandidate & {
  id: string;
  createdDay: string;
  updatedDay: string;
};

export type AliceMemory = {
  version: 2;
  enabled: boolean;
  items: AliceMemoryItem[];
  pausedCategories: AliceMemoryCategory[];
};

export type AliceMemoryStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
};

/**
 * Why a candidate is refused. The screens show the matching sentence next to
 * an edit field, and the explicit "remember that" path answers with it.
 */
export type AliceMemoryRefusalReason =
  | 'secret'
  | 'address'
  | 'amount'
  | 'activity'
  | 'exchange'
  | 'identity'
  | 'sensitive'
  | 'location'
  | 'too-short'
  | 'too-long';

// Display order of the fields in "What Alice remembers". The model may
// propose any category except 'requested-note', which only the explicit
// request path in the turn planner fills.
export const ALICE_MEMORY_CATEGORIES: readonly AliceMemoryCategory[] = [
  'preference',
  'setup',
  'experience',
  'goal',
  'project',
  'interest',
  'constraint',
  'background',
  'requested-note',
];

export const ALICE_MEMORY_CATEGORY_LABELS: Record<SupportedLanguage, Record<AliceMemoryCategory, string>> = {
  en: {
    preference: 'Preferences',
    setup: 'Setup',
    experience: 'Experience',
    goal: 'Goals',
    project: 'Projects',
    interest: 'Interests',
    constraint: 'Constraints',
    background: 'Background',
    'requested-note': 'Requested notes',
  },
  fr: {
    preference: 'Préférences',
    setup: 'Installation',
    experience: 'Expérience',
    goal: 'Objectifs',
    project: 'Projets',
    interest: "Centres d'intérêt",
    constraint: 'Contraintes',
    background: 'Contexte',
    'requested-note': 'Notes demandées',
  },
};

export const ALICE_MEMORY_WARNING: Record<SupportedLanguage, string> = {
  en: 'Alice can get this wrong: these filters are a safeguard, not a guarantee. Give her the minimum, never an address, a key, a recovery phrase or an amount.',
  fr: "Alice peut se tromper : ces filtres sont un garde-fou, pas une garantie. Donnez-lui le minimum, jamais d'adresse, de clé, de phrase de récupération ni de montant.",
};

const CATEGORIES = new Set<AliceMemoryCategory>(ALICE_MEMORY_CATEGORIES);
const MODEL_CATEGORIES = new Set<AliceMemoryCategory>(ALICE_MEMORY_CATEGORIES.filter(category => category !== 'requested-note'));
export const MAX_TEXT_LENGTH = 160;
const MIN_TEXT_LENGTH = 3;
// Per turn, across the model block and the fixed patterns. The store itself
// has no cap since 2026-10-06: the screen folds everything past the fifty most
// recent facts into an "older" section instead of dropping them.
const MAX_CANDIDATES_PER_TURN = 3;
export const ALICE_MEMORY_RECENT_LIMIT = 50;
const MEMORY_BLOCK = /\s*<alice_memory>([\s\S]*?)<\/alice_memory>\s*$/i;

// Amounts. A number, or a small number word, followed by a bitcoin or fiat
// unit ("0.5 BTC", "20 000 sats", "150 €", "2 bitcoins", "20k sats"), or a
// currency symbol or code followed by a number ("$300", "EUR 150"). A bare
// number stays allowed: "since 2021" and "2-of-3" describe nothing to spend.
const AMOUNT_UNIT = String.raw`(?:btc|xbt|bitcoins?|sats?|satoshis?|msats?|€|eur|euros?|\$|usd|dollars?|£|gbp|pounds?|chf|francs?|¥|yen|jpy|cad|aud|cny|yuan)`;
const AMOUNT_NUMBER = String.raw`\d+(?:[ .,'’  ]\d+)*`;
const AMOUNT_WORD = String.raw`\b(?:two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred|thousand|million|half|several|a few|a couple of|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|vingt|cinquante|cent|mille|million|demi|plusieurs|quelques)\b`;
const AMOUNT_NOUN = String.raw`(?:wallets?|portefeuilles?|nodes?|n(?:oe|œ)uds?|apps?|applications?|books?|livres?|podcasts?|meetups?|conf[eé]rences?|friends?|amis?|projects?|projets?|courses?|cours|articles?|videos?|vid[eé]os?|years?|ans|months?|mois|addresses|adresses|exchanges?|plateformes?|companies|entreprises?|ATMs?|users?|utilisateurs?|developers?|d[eé]veloppeurs?|educators?|standards?|upgrades?|forks?)\b`;
const AMOUNT_PATTERNS = [
  new RegExp(String.raw`(?:${AMOUNT_NUMBER}|${AMOUNT_WORD})\s*(?:k|m)?\s*${AMOUNT_UNIT}(?![a-z])(?!\s+${AMOUNT_NOUN})`, 'i'),
  new RegExp(String.raw`(?:[€$£¥]|\b(?:eur|usd|gbp|chf|btc|xbt))\s*${AMOUNT_NUMBER}`, 'i'),
  /\b(?:half|quarter)\s+(?:a|of a|an)\s+(?:bitcoin|btc)\b/i,
  /\b(?:un|une|a|an)\s+(?:demi|half)[- ](?:bitcoin|btc)\b/i,
];

// Exchange accounts. An unambiguous exchange name is refused on sight; a
// name that is also an ordinary word needs an account, wallet or KYC word in
// the same sentence.
const EXCHANGE_NAMES = /\b(?:binance|kraken|coinbase|bitstamp|bitfinex|bitpanda|bitvavo|paymium|okx|bybit|kucoin|bitget|bittrex|poloniex|huobi|htx|mexc|gate\.io|cex\.io|etoro|robinhood|crypto\.com|upbit|bithumb)\b/i;
const AMBIGUOUS_EXCHANGE_NAMES = /\b(?:gemini|strike|river|swan|relai|revolut|n26|paypal|cash app|bull bitcoin|ledger live)\b/i;
const ACCOUNT_WORDS = /\b(?:compte|account|wallet|portefeuille|kyc|exchange|plateforme|platform|login|identifiant|verified|vérifié|verifie)\b/i;

// These details are either wallet secrets, financial activity, direct
// identifiers, precise location, or sensitive personal attributes. They are
// never accepted as durable memory, even if a model proposes them or the user
// asks for them to be kept.
const FORBIDDEN_MEMORY: Array<{ reason: AliceMemoryRefusalReason; pattern: RegExp }> = [
  { reason: 'secret', pattern: /\b(seed phrase|recovery phrase|mnemonic|private key|cle privee|clé privée|phrase de recuperation|phrase de récupération|phrase secrete|phrase secrète|xprv|nsec)\b/i },
  { reason: 'address', pattern: /\b(address|adresse|invoice|facture)\b/i },
  { reason: 'activity', pattern: /\b(txid|transaction|balance|solde|sats?|bitcoin balance)\b/i },
  // "Phone" alone is a device ("only has a phone, no computer" is a valid
  // constraint); a phone number is caught by the raw-value rule below.
  { reason: 'identity', pattern: /\b(email|e-mail|phone number|numero de telephone|numéro de téléphone|user\s?id|username|password|mot de passe)\b/i },
  { reason: 'identity', pattern: /\b(my name|name is|named|first name|last name|je m appelle|je m'appelle|mon nom|prenom|prénom|nom de famille)\b/i },
  { reason: 'sensitive', pattern: /\b(health|medical|diagnos|disease|maladie|sante|santé|sexual|religion|politic|politique)\b/i },
  { reason: 'location', pattern: /\b(lives? at|habite au|habite à|home address|adresse personnelle|gps|coordinates?)\b/i },
];

// Models may return a raw value without naming what it is. These patterns
// reject common credentials and direct identifiers even when words such as
// "address", "email", or "private key" are absent.
const FORBIDDEN_RAW_VALUE: Array<{ reason: AliceMemoryRefusalReason; pattern: RegExp }> = [
  { reason: 'identity', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { reason: 'address', pattern: /\b(?:bc1|tb1|bcrt1)[ac-hj-np-z02-9]{11,87}\b/i },
  { reason: 'address', pattern: /\b[13mn2][1-9A-HJ-NP-Za-km-z]{25,61}\b/ },
  { reason: 'address', pattern: /\bln(?:bc|tb|bcrt)[0-9a-z]{20,}\b/i },
  { reason: 'address', pattern: /\b(?:nsec|npub|note|nevent|nprofile)1[02-9ac-hj-np-z]{20,}\b/i },
  { reason: 'secret', pattern: /\b(?:xpub|ypub|zpub|tpub|upub|vpub|xprv|yprv|zprv|tprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{20,}\b/i },
  { reason: 'secret', pattern: /\b(?:0x)?[a-f0-9]{64}\b/i },
  { reason: 'identity', pattern: /\b[a-z0-9._-]{2,32}#[0-9]{4}\b/i },
  { reason: 'identity', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
  { reason: 'identity', pattern: /(?:^|\s)\+?\d[\d\s().-]{7,}\d(?:\s|$)/ },
];

export const ALICE_MEMORY_CAPTURE_INSTRUCTION = `Memory capture protocol. After the visible answer, append exactly one optional block in this format:
<alice_memory>{"items":[{"category":"preference|setup|experience|goal|project|interest|background|constraint","text":"short factual memory"}]}</alice_memory>
Use 0 to 3 items. Save only facts the user explicitly stated about themselves that would materially improve future answers. Do not infer identity, personality, beliefs, expertise, or circumstances.
Categories: preference (answer length, tone, examples, format), setup (the hardware and rails the user says they use, never an identifier, a balance or a provider account), experience (the user's history and habits with Bitcoin, never a dated operation or a counterparty), goal, project, interest, background (situation without place or identity), constraint (practical limits to respect).
Setup, keep: "Uses a hardware wallet with a 2-of-3 multisig". Setup, never: "Keeps 0.5 BTC on a hardware wallet" (an amount).
Experience, keep: "Has used Bitcoin since 2021 and once lost access to a wallet". Experience, never: "Bought bitcoin on Coinbase in 2021" (an exchange account).
Never save message text, wallet data, financial activity, amounts in any unit, exchange or platform accounts, direct identifiers, location, health, politics, religion, sexuality, secrets, addresses, balances, transactions, or credentials. A statement about what the user knows is handled separately and must not be added here. If nothing qualifies, append <alice_memory>{"items":[]}</alice_memory>. The block is private protocol output and must appear only once, at the very end.`;

function todayLocal(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeAliceMemoryText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[-*•\s]+/, '').trim();
}

function normalizedKey(category: AliceMemoryCategory, text: string): string {
  let value = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (category === 'preference') {
    value = value.replace(/^(?:i |user )?(?:prefers?|likes?|wants?)\s+/, '');
  } else if (category === 'project') {
    value = value.replace(/^(?:i am |user is )?(?:working on|building|developing)\s+/, '');
  }
  return `${category}:${value}`;
}

function memoryId(category: AliceMemoryCategory, text: string): string {
  const input = normalizedKey(category, text);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `memory-${(hash >>> 0).toString(36)}`;
}

function isExchangeAccount(text: string): boolean {
  if (EXCHANGE_NAMES.test(text)) return true;
  return AMBIGUOUS_EXCHANGE_NAMES.test(text) && ACCOUNT_WORDS.test(text);
}

/**
 * The reason a text can never be kept, or null when it passes every filter.
 * The order matters only for the reason reported: a seed phrase that also
 * names an amount is refused as a secret.
 */
export function aliceMemoryRefusalReason(value: string): AliceMemoryRefusalReason | null {
  const text = normalizeAliceMemoryText(value);
  if (text.length < MIN_TEXT_LENGTH) return 'too-short';
  if (text.length > MAX_TEXT_LENGTH) return 'too-long';
  if (detectSensitiveInput(text)) return 'secret';
  for (const rule of FORBIDDEN_RAW_VALUE) {
    if (rule.pattern.test(text)) return rule.reason;
  }
  if (AMOUNT_PATTERNS.some(pattern => pattern.test(text))) return 'amount';
  if (isExchangeAccount(text)) return 'exchange';
  for (const rule of FORBIDDEN_MEMORY) {
    if (rule.pattern.test(text)) return rule.reason;
  }
  return null;
}

const REFUSAL_SUBJECT: Record<SupportedLanguage, Record<AliceMemoryRefusalReason, string>> = {
  en: {
    secret: 'a recovery phrase or a key',
    address: 'an address, an invoice or a payment identifier',
    amount: 'an amount',
    activity: 'a balance, a transaction or wallet activity',
    exchange: 'an exchange or platform account',
    identity: 'an identity or contact detail',
    sensitive: 'a sensitive personal detail (health, religion, politics, sexuality)',
    location: 'a place',
    'too-short': 'too little text',
    'too-long': `more than ${MAX_TEXT_LENGTH} characters`,
  },
  fr: {
    secret: 'une phrase de récupération ou une clé',
    address: 'une adresse, une facture ou un identifiant de paiement',
    amount: 'un montant',
    activity: "un solde, une transaction ou une activité du portefeuille",
    exchange: "un compte sur une plateforme d'échange",
    identity: "une donnée d'identité ou de contact",
    sensitive: 'une donnée sensible (santé, religion, politique, sexualité)',
    location: 'un lieu',
    'too-short': 'trop peu de texte',
    'too-long': `plus de ${MAX_TEXT_LENGTH} caractères`,
  },
};

/** One sentence naming what was refused, for the screens and the chat. */
export function aliceMemoryRefusalMessage(reason: AliceMemoryRefusalReason, language: SupportedLanguage): string {
  const subject = REFUSAL_SUBJECT[language][reason];
  if (reason === 'too-short' || reason === 'too-long') {
    return language === 'fr'
      ? `Alice ne peut pas retenir cette phrase : ${subject}.`
      : `Alice cannot keep this sentence: ${subject}.`;
  }
  return language === 'fr'
    ? `Alice ne peut pas retenir cette phrase : elle contient ${subject}. Les adresses, clés, phrases de récupération, montants et données d'identité ne sont jamais conservés, même sur demande, parce qu'un filtre peut se tromper et que rien de tout cela n'aide à mieux répondre.`
    : `Alice cannot keep this sentence: it contains ${subject}. Addresses, keys, recovery phrases, amounts and identity details are never kept, even on request, because a filter can be wrong and none of it helps her answer better.`;
}

function isSafeCandidate(value: unknown): value is AliceMemoryCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.category !== 'string' || !CATEGORIES.has(candidate.category as AliceMemoryCategory)) return false;
  if (typeof candidate.text !== 'string') return false;
  return aliceMemoryRefusalReason(candidate.text) === null;
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Reads the current format (2) and the first one (1: no paused categories,
// at most twenty items). Nothing is dropped from an older store: every item
// that still passes the filters is kept.
function parseMemory(raw: string | null): AliceMemory | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if ((parsed.version !== 1 && parsed.version !== 2) || typeof parsed.enabled !== 'boolean' || !Array.isArray(parsed.items)) return null;
    const items: AliceMemoryItem[] = [];
    const seen = new Set<string>();
    for (const value of parsed.items) {
      if (!isSafeCandidate(value)) continue;
      const candidate = value as Record<string, unknown>;
      const category = candidate.category as AliceMemoryCategory;
      const text = normalizeAliceMemoryText(candidate.text as string);
      const key = normalizedKey(category, text);
      if (seen.has(key)) continue;
      const createdDay = isDay(candidate.createdDay) ? candidate.createdDay : todayLocal();
      const updatedDay = isDay(candidate.updatedDay) ? candidate.updatedDay : createdDay;
      items.push({ id: memoryId(category, text), category, text, createdDay, updatedDay });
      seen.add(key);
    }
    const pausedCategories = Array.isArray(parsed.pausedCategories)
      ? (parsed.pausedCategories as unknown[]).filter((value): value is AliceMemoryCategory => (
        typeof value === 'string' && CATEGORIES.has(value as AliceMemoryCategory)
      ))
      : [];
    return { version: 2, enabled: parsed.enabled, items, pausedCategories: [...new Set(pausedCategories)] };
  } catch {
    return null;
  }
}

/** The outcome of a write: the memory as computed, and whether it reached the store. */
export type AliceMemoryWrite = { memory: AliceMemory; saved: boolean };

// A failed write never throws: personalization must never interrupt a chat
// response. The flag lets a caller that promised a save say when it did not
// happen instead of confirming from the in-memory object.
async function write(storage: AliceMemoryStorage, memory: AliceMemory): Promise<AliceMemoryWrite> {
  try {
    await storage.write(JSON.stringify(memory));
    return { memory, saved: true };
  } catch {
    return { memory, saved: false };
  }
}

async function save(storage: AliceMemoryStorage, memory: AliceMemory): Promise<AliceMemory> {
  return (await write(storage, memory)).memory;
}

export function createAliceMemory(): AliceMemory {
  return { version: 2, enabled: true, items: [], pausedCategories: [] };
}

export function isAliceMemoryCategoryPaused(memory: AliceMemory, category: AliceMemoryCategory): boolean {
  return memory.pausedCategories.includes(category);
}

export function parseAliceMemoryResponse(text: string): {
  visibleText: string;
  candidates: AliceMemoryCandidate[];
} {
  const match = text.match(MEMORY_BLOCK);
  if (!match) {
    const incompleteBlock = text.toLowerCase().lastIndexOf('<alice_memory>');
    return {
      visibleText: (incompleteBlock >= 0 ? text.slice(0, incompleteBlock) : text).trim(),
      candidates: [],
    };
  }

  const visibleText = text.slice(0, match.index).trim();
  try {
    const payload = JSON.parse(match[1]) as Record<string, unknown>;
    const values = Array.isArray(payload.items) ? payload.items : [];
    const candidates = values
      .filter(isSafeCandidate)
      // A requested note comes only from the user's explicit request, never
      // from the model's block.
      .filter(value => MODEL_CATEGORIES.has(value.category))
      .slice(0, MAX_CANDIDATES_PER_TURN)
      .map(value => ({
        category: value.category,
        text: normalizeAliceMemoryText(value.text),
      }));
    return { visibleText, candidates };
  } catch {
    return { visibleText, candidates: [] };
  }
}

export async function getAliceMemoryFromStorage(storage: AliceMemoryStorage): Promise<AliceMemory> {
  try {
    return parseMemory(await storage.read()) ?? createAliceMemory();
  } catch {
    return createAliceMemory();
  }
}

export async function rememberAliceCandidatesInStorage(
  candidates: AliceMemoryCandidate[],
  storage: AliceMemoryStorage,
  now = new Date(),
): Promise<AliceMemory> {
  return (await writeAliceCandidatesToStorage(candidates, storage, now)).memory;
}

/** Same as rememberAliceCandidatesInStorage, and says whether the write succeeded. */
export async function writeAliceCandidatesToStorage(
  candidates: AliceMemoryCandidate[],
  storage: AliceMemoryStorage,
  now = new Date(),
): Promise<AliceMemoryWrite> {
  const current = await getAliceMemoryFromStorage(storage);
  if (!current.enabled) return { memory: current, saved: true };
  const day = todayLocal(now);
  const next = [...current.items];
  const existing = new Set(next.map(item => normalizedKey(item.category, item.text)));
  let added = 0;
  for (const candidate of candidates.filter(isSafeCandidate)) {
    if (added >= MAX_CANDIDATES_PER_TURN) break;
    if (isAliceMemoryCategoryPaused(current, candidate.category)) continue;
    const text = normalizeAliceMemoryText(candidate.text);
    const key = normalizedKey(candidate.category, text);
    if (existing.has(key)) continue;
    next.push({ id: memoryId(candidate.category, text), category: candidate.category, text, createdDay: day, updatedDay: day });
    existing.add(key);
    added += 1;
  }
  if (added === 0) return { memory: current, saved: true };
  return write(storage, { ...current, items: next });
}

export async function forgetAliceMemoryItemInStorage(id: string, storage: AliceMemoryStorage): Promise<AliceMemory> {
  const current = await getAliceMemoryFromStorage(storage);
  return save(storage, { ...current, items: current.items.filter(item => item.id !== id) });
}

/**
 * Replaces the text of one item. The new text goes through the same filters
 * as a capture; when refused, nothing changes and the reason comes back. An
 * edit that lands on another item's text keeps the edited one and drops the
 * other, so two rows never say the same thing.
 */
export async function editAliceMemoryItemInStorage(
  id: string,
  text: string,
  storage: AliceMemoryStorage,
  now = new Date(),
): Promise<{ memory: AliceMemory; refusal: AliceMemoryRefusalReason | null }> {
  const current = await getAliceMemoryFromStorage(storage);
  const target = current.items.find(item => item.id === id);
  if (!target) return { memory: current, refusal: null };
  const refusal = aliceMemoryRefusalReason(text);
  if (refusal) return { memory: current, refusal };
  const nextText = normalizeAliceMemoryText(text);
  const nextId = memoryId(target.category, nextText);
  const edited: AliceMemoryItem = { ...target, id: nextId, text: nextText, updatedDay: todayLocal(now) };
  const items = current.items
    .filter(item => item.id !== nextId || item.id === id)
    .map(item => (item.id === id ? edited : item));
  return { memory: await save(storage, { ...current, items }), refusal: null };
}

export async function clearAliceMemoryCategoryInStorage(
  category: AliceMemoryCategory,
  storage: AliceMemoryStorage,
): Promise<AliceMemory> {
  const current = await getAliceMemoryFromStorage(storage);
  return save(storage, { ...current, items: current.items.filter(item => item.category !== category) });
}

/** Pausing a category stops capture into it without erasing what it holds. */
export async function setAliceMemoryCategoryPausedInStorage(
  category: AliceMemoryCategory,
  paused: boolean,
  storage: AliceMemoryStorage,
): Promise<AliceMemory> {
  const current = await getAliceMemoryFromStorage(storage);
  const others = current.pausedCategories.filter(value => value !== category);
  return save(storage, { ...current, pausedCategories: paused ? [...others, category] : others });
}

export async function setAliceMemoryEnabledInStorage(enabled: boolean, storage: AliceMemoryStorage): Promise<AliceMemory> {
  const current = await getAliceMemoryFromStorage(storage);
  return save(storage, { ...current, enabled });
}

export async function clearAliceMemoryFromStorage(storage: AliceMemoryStorage): Promise<void> {
  await storage.remove();
}

// How a memory item earns its place in the context window.
//
// "The last ten" was the old rule, and recency is the wrong axis: the fact
// that helps answer a Lightning question may be three weeks old, and the ten
// newest items may all be about something else entirely. Two kinds of items,
// two rules. Preferences and constraints shape every answer whatever the
// topic, so they always ride, and so does a note the user asked for in so
// many words. The topical kinds (setup, experience, goals, projects,
// interests, background) are scored by word overlap with the current message
// and only the ones that touch it come along; when nothing matches, the
// newest fill the remaining seats, which is exactly the old behaviour as the
// fallback rather than the policy.
const ALWAYS_RELEVANT: ReadonlySet<AliceMemoryCategory> = new Set(['preference', 'constraint', 'requested-note']);
const MEMORY_CONTEXT_ITEMS = 10;

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 4),
  );
}

export function aliceMemoryContext(memory: AliceMemory, userMessage = ''): string {
  if (!memory.enabled || memory.items.length === 0) return '';

  const newestFirst = [...memory.items].reverse();
  const standing = newestFirst.filter(item => ALWAYS_RELEVANT.has(item.category));
  const topical = newestFirst.filter(item => !ALWAYS_RELEVANT.has(item.category));

  const messageWords = contentWords(userMessage);
  const scored = topical
    .map((item, index) => {
      let score = 0;
      for (const word of contentWords(item.text)) {
        if (messageWords.has(word)) score += 1;
      }
      return { item, score, index };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const picked = [
    ...standing.slice(0, MEMORY_CONTEXT_ITEMS),
    ...scored
      .filter(entry => entry.score > 0)
      .map(entry => entry.item),
  ].slice(0, MEMORY_CONTEXT_ITEMS);
  if (picked.length < MEMORY_CONTEXT_ITEMS) {
    for (const entry of scored) {
      if (picked.length >= MEMORY_CONTEXT_ITEMS) break;
      if (!picked.includes(entry.item)) picked.push(entry.item);
    }
  }

  return [
    'Private device-local memory. Use it only when relevant. It never overrides the current user message.',
    ...picked.map(item => `- ${item.text}`),
  ].join('\n');
}
