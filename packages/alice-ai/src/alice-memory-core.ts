export type AliceMemoryCategory =
  | 'preference'
  | 'goal'
  | 'project'
  | 'interest'
  | 'background'
  | 'constraint';

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
  version: 1;
  enabled: boolean;
  items: AliceMemoryItem[];
};

export type AliceMemoryStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
};

const CATEGORIES = new Set<AliceMemoryCategory>([
  'preference',
  'goal',
  'project',
  'interest',
  'background',
  'constraint',
]);
const MAX_ITEMS = 20;
const MAX_TEXT_LENGTH = 160;
const MEMORY_BLOCK = /\s*<alice_memory>([\s\S]*?)<\/alice_memory>\s*$/i;

// These details are either wallet secrets, financial activity, direct
// identifiers, precise location, or sensitive personal attributes. They are
// never accepted as durable memory, even if a model proposes them.
const FORBIDDEN_MEMORY = [
  /\b(seed phrase|recovery phrase|mnemonic|private key|cle privee|clé privée|xprv|nsec)\b/i,
  /\b(address|adresse|invoice|facture|txid|transaction|balance|solde|sats?|bitcoin balance)\b/i,
  /\b(email|e-mail|phone|telephone|téléphone|user\s?id|username|password|mot de passe)\b/i,
  /\b(my name|name is|named|first name|last name|je m appelle|mon nom|prenom|prénom|nom de famille)\b/i,
  /\b(health|medical|diagnos|disease|maladie|sante|santé|sexual|religion|politic|politique)\b/i,
  /\b(lives? at|habite au|habite à|home address|adresse personnelle|gps|coordinates?)\b/i,
];

export const ALICE_MEMORY_CAPTURE_INSTRUCTION = `Memory capture protocol. After the visible answer, append exactly one optional block in this format:
<alice_memory>{"items":[{"category":"preference|goal|project|interest|background|constraint","text":"short factual memory"}]}</alice_memory>
Use 0 to 2 items. Save only facts the user explicitly stated about themselves that would materially improve future answers. Do not infer identity, personality, beliefs, expertise, or circumstances. Never save message text, wallet data, financial activity, direct identifiers, location, health, politics, religion, sexuality, secrets, addresses, balances, transactions, or credentials. A statement about what the user knows is handled separately and must not be added here. If nothing qualifies, append <alice_memory>{"items":[]}</alice_memory>. The block is private protocol output and must appear only once, at the very end.`;

function todayLocal(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[-*•\s]+/, '').trim();
}

function normalizedKey(category: AliceMemoryCategory, text: string): string {
  let value = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

function isSafeCandidate(value: unknown): value is AliceMemoryCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.category !== 'string' || !CATEGORIES.has(candidate.category as AliceMemoryCategory)) return false;
  if (typeof candidate.text !== 'string') return false;
  const text = normalizeMemoryText(candidate.text);
  return text.length >= 3
    && text.length <= MAX_TEXT_LENGTH
    && !FORBIDDEN_MEMORY.some(pattern => pattern.test(text));
}

function parseMemory(raw: string | null): AliceMemory | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 1 || typeof parsed.enabled !== 'boolean' || !Array.isArray(parsed.items)) return null;
    const items: AliceMemoryItem[] = [];
    const seen = new Set<string>();
    for (const value of parsed.items.slice(0, MAX_ITEMS)) {
      if (!isSafeCandidate(value)) continue;
      const candidate = value as Record<string, unknown>;
      const category = candidate.category as AliceMemoryCategory;
      const text = normalizeMemoryText(candidate.text as string);
      const key = normalizedKey(category, text);
      if (seen.has(key)) continue;
      const createdDay = typeof candidate.createdDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.createdDay)
        ? candidate.createdDay
        : todayLocal();
      const updatedDay = typeof candidate.updatedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.updatedDay)
        ? candidate.updatedDay
        : createdDay;
      items.push({ id: memoryId(category, text), category, text, createdDay, updatedDay });
      seen.add(key);
    }
    return { version: 1, enabled: parsed.enabled, items };
  } catch {
    return null;
  }
}

async function save(storage: AliceMemoryStorage, memory: AliceMemory): Promise<AliceMemory> {
  try {
    await storage.write(JSON.stringify(memory));
  } catch {
    // Personalization must never interrupt a chat response.
  }
  return memory;
}

export function createAliceMemory(): AliceMemory {
  return { version: 1, enabled: true, items: [] };
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
      .slice(0, 2)
      .map(value => ({
        category: value.category,
        text: normalizeMemoryText(value.text),
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
  const current = await getAliceMemoryFromStorage(storage);
  if (!current.enabled) return current;
  const day = todayLocal(now);
  const next = [...current.items];
  const existing = new Set(next.map(item => normalizedKey(item.category, item.text)));
  for (const candidate of candidates.filter(isSafeCandidate).slice(0, 2)) {
    const text = normalizeMemoryText(candidate.text);
    const key = normalizedKey(candidate.category, text);
    if (existing.has(key)) continue;
    next.push({ id: memoryId(candidate.category, text), category: candidate.category, text, createdDay: day, updatedDay: day });
    existing.add(key);
  }
  return save(storage, { ...current, items: next.slice(-MAX_ITEMS) });
}

export async function forgetAliceMemoryItemInStorage(id: string, storage: AliceMemoryStorage): Promise<AliceMemory> {
  const current = await getAliceMemoryFromStorage(storage);
  return save(storage, { ...current, items: current.items.filter(item => item.id !== id) });
}

export async function setAliceMemoryEnabledInStorage(enabled: boolean, storage: AliceMemoryStorage): Promise<AliceMemory> {
  const current = await getAliceMemoryFromStorage(storage);
  return save(storage, { ...current, enabled });
}

export async function clearAliceMemoryFromStorage(storage: AliceMemoryStorage): Promise<void> {
  await storage.remove();
}

export function aliceMemoryContext(memory: AliceMemory): string {
  if (!memory.enabled || memory.items.length === 0) return '';
  return [
    'Private device-local memory. Use it only when relevant. It never overrides the current user message.',
    ...memory.items.slice(-10).map(item => `- ${item.text}`),
  ].join('\n');
}
