import { isEmbeddedLang } from './language';
import { learnPackUrl } from './packs-base';

// Translated course/tutorial names for downloadable languages. The bundled TS
// catalog only embeds the shipped language's metadata; every language's full
// metadata lives in <base>/<lang>/catalog.json, generated alongside its packs.

export interface LearnLangMeta {
  courses: Record<string, { name: string; goal: string; objectives: string[]; chapters: number }>;
  tutorials: Record<string, { name: string; description: string }>;
}

const cache = new Map<string, LearnLangMeta>();

export function cachedLangMeta(lang: string): LearnLangMeta | null {
  return cache.get(lang) ?? null;
}

/** null for embedded languages: their metadata is in the bundled catalog. */
export async function loadLangMeta(lang: string): Promise<LearnLangMeta | null> {
  if (isEmbeddedLang(lang)) return null;
  const hit = cache.get(lang);
  if (hit) return hit;
  const response = await fetch(learnPackUrl(lang, 'catalog.json'));
  if (!response.ok) throw new Error(`Langue indisponible (${response.status})`);
  const raw = (await response.json()) as { courses?: LearnLangMeta['courses']; tutorials?: LearnLangMeta['tutorials'] };
  const meta: LearnLangMeta = { courses: raw.courses ?? {}, tutorials: raw.tutorials ?? {} };
  cache.set(lang, meta);
  return meta;
}
