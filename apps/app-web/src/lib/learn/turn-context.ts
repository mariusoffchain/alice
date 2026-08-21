import {
  LEARN_COURSES,
  LEARN_TUTORIALS,
} from '@alice-wallet/alice-content/src/generated/planb-learn-catalog';
import { registerLearnContextProvider, type LearnTurnContext } from '@alice-wallet/alice-ai';
import { fetchCoursePack, fetchTutorialPack } from './packs';
import { defaultLearnLanguage, isWhitelistedLang, loadLearnLanguage } from './language';
import { takeSuggestion } from './suggest';
import { excerptOf, pickChapter } from './turn-context-score';


// Feeds the chat turn with the text of the course a question points at (see
// packages/alice-ai/src/learn-context.ts for the contract). The suggestion
// scorer already knows how to map a question onto the catalog, the same
// engine that fills the "To go further" block; here its match is followed one
// step further, into the pack itself, chapter by chapter. Local languages
// (en/fr embedded, downloaded ones cached) answer instantly; anything slower
// than the bridge's timeout simply ships no excerpt.

function learnLanguage(): string {
  return loadLearnLanguage()
    ?? defaultLearnLanguage(typeof navigator === 'undefined' ? undefined : navigator.language);
}

async function courseContext(query: string): Promise<LearnTurnContext | null> {
  const lang = learnLanguage();
  // A throwaway Set: the context lookup must never consume the "suggest each
  // content once per session" budget owned by the visible block.
  const suggestion = takeSuggestion(query, [lang, 'fr', 'en'], LEARN_COURSES, LEARN_TUTORIALS, new Set());
  if (!suggestion) return null;

  if (suggestion.kind === 'tutorial' && suggestion.category && suggestion.slug) {
    const tutorial = LEARN_TUTORIALS.find(t => t.slug === suggestion.slug && t.category === suggestion.category);
    const packLang = tutorial?.languages.includes(lang) ? lang : 'en';
    if (!isWhitelistedLang(packLang)) return null;
    const pack = await fetchTutorialPack(packLang, suggestion.category, suggestion.slug);
    return {
      label: `${pack.name} (Plan ₿ Academy tutorial)`,
      excerpt: excerptOf(pack.markdown),
    };
  }

  const course = LEARN_COURSES.find(c => c.code === suggestion.code);
  const packLang = course?.languages.includes(lang) ? lang : 'en';
  if (!isWhitelistedLang(packLang)) return null;
  const pack = await fetchCoursePack(packLang, suggestion.code);
  const chapter = pickChapter(query, pack);
  if (!chapter) return null;
  return {
    label: `${pack.name} · ${chapter.title} (Plan ₿ Academy)`,
    excerpt: excerptOf(chapter.markdown),
  };
}

/** Wire the provider once, from the app shell. */
export function registerLearnTurnContext(): void {
  registerLearnContextProvider(courseContext);
}
