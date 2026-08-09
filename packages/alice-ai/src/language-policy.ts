export type SupportedLanguage = 'fr' | 'en';
export type ResponseLanguagePreference = 'auto' | SupportedLanguage;
export type LanguageDecisionSource = 'explicit' | 'preference' | 'message' | 'interface';

export type LanguageDecision = {
  targetLanguage: SupportedLanguage;
  source: LanguageDecisionSource;
  confidence: number;
};

type Detection = { language: SupportedLanguage; confidence: number } | null;

const FRENCH_WORDS = new Set([
  'alors', 'avec', 'avoir', 'bonjour', 'car', 'ce', 'ces', 'comment', 'dans', 'des', 'donc',
  'elle', 'est', 'et', 'faire', 'francais', 'il', 'je', 'la', 'langue', 'le', 'les', 'mais',
  'nous', 'ou', 'par', 'pas', 'peux', 'pour', 'pourquoi', 'que', 'quel', 'quelle', 'qui',
  'repondre', 'reponse', 'reponses', 'compris', 'concis', 'concise', 'vais', 'aider', 'accord',
  'sans', 'sur', 'tu', 'une', 'vous', 'quoi', 'bitcoin',
]);

const ENGLISH_WORDS = new Set([
  'about', 'answer', 'are', 'bitcoin', 'can', 'could', 'do', 'does', 'english', 'explain', 'for',
  'from', 'got', 'have', 'help', 'how', 'in', 'is', 'it', 'keep', 'language', 'me', 'next', 'of',
  'please', 'reply', 'replies', 'concise', 'should', 'that', 'the', 'this', 'to', 'understood',
  'what', 'when', 'where', 'which', 'why', 'will', 'with', 'you', 'your',
]);

const EXPLICIT_FRENCH = /\b(?:reponds?|repondez|answer|reply|continue|parle|ecris)\b[\s\S]{0,30}\b(?:en\s+)?fran[cç]ais\b/i;
const EXPLICIT_ENGLISH = /\b(?:answer|reply|continue|speak|write|reponds?|repondez)\b[\s\S]{0,30}\b(?:in\s+|en\s+)?(?:english|anglais)\b/i;

function normalizedWords(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^>.*$/gm, ' ')
    .replace(/[«“"][^»”"\n]{2,}[»”"]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z]+/g) ?? [];
}

export function detectExplicitResponseLanguage(text: string): SupportedLanguage | null {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (EXPLICIT_FRENCH.test(normalized)) return 'fr';
  if (EXPLICIT_ENGLISH.test(normalized)) return 'en';
  return null;
}

export function detectTextLanguage(text: string): Detection {
  const words = normalizedWords(text);
  if (words.length === 0) return null;

  let french = 0;
  let english = 0;
  for (const word of words) {
    if (FRENCH_WORDS.has(word)) french += 1;
    if (ENGLISH_WORDS.has(word)) english += 1;
  }
  if (/[àâçéèêëîïôùûüÿœ]/i.test(text)) french += 2;

  const strongest = Math.max(french, english);
  const difference = Math.abs(french - english);
  if (strongest < 2 || difference < 1) return null;

  return {
    language: french > english ? 'fr' : 'en',
    confidence: Math.min(0.99, 0.55 + difference / Math.max(6, words.length)),
  };
}

export function resolveResponseLanguage(input: {
  message: string;
  preference?: ResponseLanguagePreference;
  interfaceLanguage?: string;
}): LanguageDecision {
  const explicit = detectExplicitResponseLanguage(input.message);
  if (explicit) return { targetLanguage: explicit, source: 'explicit', confidence: 1 };

  if (input.preference && input.preference !== 'auto') {
    return { targetLanguage: input.preference, source: 'preference', confidence: 1 };
  }

  const current = detectTextLanguage(input.message);
  if (current) return { targetLanguage: current.language, source: 'message', confidence: current.confidence };

  const interfaceLanguage = input.interfaceLanguage?.toLowerCase() ?? '';
  return {
    targetLanguage: interfaceLanguage.startsWith('fr') ? 'fr' : 'en',
    source: 'interface',
    confidence: 0.5,
  };
}

export function isResponseLanguageAcceptable(text: string, target: SupportedLanguage): boolean {
  const detected = detectTextLanguage(text);
  // Very short answers, code, URLs, and proper nouns do not provide enough
  // evidence for a safe rejection. The prompt policy remains authoritative.
  if (!detected) return true;
  return detected.language === target;
}

export function languageName(language: SupportedLanguage): string {
  return language === 'fr' ? 'French' : 'English';
}

export function localizedLanguageFailure(language: SupportedLanguage): string {
  return language === 'fr'
    ? "Alice n'a pas pu produire une réponse fiable en français. Réessaie dans un instant."
    : 'Alice could not produce a reliable answer in English. Try again in a moment.';
}
