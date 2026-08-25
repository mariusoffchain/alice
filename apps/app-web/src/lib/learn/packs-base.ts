import { isEmbeddedLang } from './language';

// Where a language's packs are served from. English and French ship inside the
// app (~29 MB); the 27 others are fetched from a remote base, so a build weighs
// 29 MB instead of 437 MB. The base is set at build time via
// NEXT_PUBLIC_LEARN_PACKS_BASE (a CDN URL on a pinned tag, same posture as the
// corpus images) and is pinned in scripts/prepare-learn-packs.mjs; left unset
// it falls back to the local copy, which is what dev uses.
//
// Any base must serve <lang>/catalog.json, <lang>/courses/<code>.json,
// <lang>/quizzes/<code>.json and <lang>/tutorials/<category>/<slug>.json.

const REMOTE_BASE = (process.env.NEXT_PUBLIC_LEARN_PACKS_BASE ?? '').replace(/\/+$/, '');

export function learnPackUrl(lang: string, filePath: string): string {
  if (!REMOTE_BASE || isEmbeddedLang(lang)) return `/learn/${lang}/${filePath}`;
  return `${REMOTE_BASE}/${lang}/${filePath}`;
}

// Cover art follows the same base, and is never embedded: unlike a language
// pack, a missing cover degrades to the pixel placeholder instead of breaking
// the screen, so it is the one asset worth trading for a lighter build.
export function learnThumbUrl(filePath: string): string {
  if (!REMOTE_BASE) return `/learn/thumbs/${filePath}`;
  return `${REMOTE_BASE}/thumbs/${filePath}`;
}
