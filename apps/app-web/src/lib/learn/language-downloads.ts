import { addInstalledLanguage } from './language';
import { loadLangMeta } from './lang-meta';
import { learnPackUrl } from './packs-base';

// "Download a language" à la PlanB: fetch the language's whole pack set (the
// browser caches what it can), then mark it installed so it joins the quick
// toggle. Progress is file-count based; a missing quiz file is normal, only
// the catalog itself is mandatory.

const CONCURRENCY = 6;

export async function downloadLanguage(
  lang: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const meta = await loadLangMeta(lang);
  if (!meta) {
    // Embedded language: nothing to fetch.
    onProgress?.(1);
    return;
  }
  const files = [
    ...Object.keys(meta.courses).flatMap((code) => [`courses/${code}.json`, `quizzes/${code}.json`]),
    ...Object.keys(meta.tutorials).map((key) => `tutorials/${key}.json`),
  ];
  let done = 0;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    await Promise.all(
      files.slice(i, i + CONCURRENCY).map((file) =>
        fetch(learnPackUrl(lang, file)).catch(() => null),
      ),
    );
    done = Math.min(i + CONCURRENCY, files.length);
    onProgress?.(done / files.length);
  }
  addInstalledLanguage(lang);
  onProgress?.(1);
}
