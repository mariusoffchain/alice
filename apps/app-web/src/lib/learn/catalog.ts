import {
  LEARN_COURSES,
  LEARN_TUTORIALS,
  PLANB_COMMIT,
} from '@alice-wallet/alice-content/src/generated/planb-learn-catalog';
import { learnThumbUrl } from './packs-base';
import type {
  LearnCatalogCourse,
  LearnCatalogTutorial,
} from '@alice-wallet/alice-content/src/learn-types';
import type { LearnLangMeta } from './lang-meta';

// Display order chosen for the Learn home, mirroring the Plan B Academy site
// sections. Topics come straight from each course.yml.
export const SECTION_ORDER = [
  'bitcoin',
  'security',
  'social studies',
  'business',
  'protocol',
  'mining',
] as const;

export const SECTION_LABELS: Record<string, { fr: string; en: string }> = {
  bitcoin: { fr: 'Bitcoin', en: 'Bitcoin' },
  security: { fr: 'Sécurité', en: 'Security' },
  'social studies': { fr: 'Études sociales', en: 'Social studies' },
  business: { fr: 'Entreprises', en: 'Business' },
  protocol: { fr: 'Protocoles', en: 'Protocols' },
  mining: { fr: 'Minage', en: 'Mining' },
};

export const TUTORIAL_CATEGORY_LABELS: Record<string, { fr: string; en: string }> = {
  wallet: { fr: 'Wallet', en: 'Wallet' },
  node: { fr: 'Nœud', en: 'Node' },
  privacy: { fr: 'Confidentialité', en: 'Privacy' },
  mining: { fr: 'Minage', en: 'Mining' },
  exchange: { fr: 'Exchange', en: 'Exchange' },
  'computer-security': { fr: 'Sécurité informatique', en: 'Computer security' },
  contribution: { fr: 'Contribution', en: 'Contribution' },
  business: { fr: 'Entreprises', en: 'Business' },
};

export const LEVEL_LABELS: Record<string, { fr: string; en: string }> = {
  beginner: { fr: 'Débutant', en: 'Beginner' },
  intermediate: { fr: 'Intermédiaire', en: 'Intermediate' },
  advanced: { fr: 'Avancé', en: 'Advanced' },
  expert: { fr: 'Expert', en: 'Expert' },
  wizard: { fr: 'Expert+', en: 'Wizard' },
};

// Course thumbnails and tutorial covers, processed per family by the build
// script: keyed drawings float on the card, photographic/banner artwork is
// letterboxed whole. Cards fall back to their pixel placeholder on error or
// offline, which is what makes serving them remotely acceptable: 9.5 MB of
// cover art has no business inside a build, and a reader without a connection
// gets the placeholder rather than a broken card. They follow the packs base,
// so a build that reads its packs remotely reads its covers there too.
export function courseThumbnailUrl(code: string): string {
  return learnThumbUrl(`${code}.webp`);
}

export function tutorialCoverUrl(category: string, slug: string): string {
  return learnThumbUrl(`tutorials/${category}/${slug}.webp`);
}

// Metadata resolution: embedded languages read the bundled catalog i18n,
// downloadable languages read the per-language catalog.json overlay.
export function courseMeta(
  course: LearnCatalogCourse,
  lang: string,
  meta?: LearnLangMeta | null,
): { name: string; goal: string; objectives: string[] } | null {
  return meta?.courses[course.code] ?? course.i18n[lang] ?? null;
}

export function courseChapterCount(
  course: LearnCatalogCourse,
  lang: string,
  meta?: LearnLangMeta | null,
): number {
  return meta?.courses[course.code]?.chapters ?? course.chapterCount[lang] ?? 0;
}

export function tutorialMeta(
  tutorial: LearnCatalogTutorial,
  lang: string,
  meta?: LearnLangMeta | null,
): { name: string; description: string } | null {
  return meta?.tutorials[`${tutorial.category}/${tutorial.slug}`] ?? tutorial.i18n[lang] ?? null;
}

export function coursesForLanguage(lang: string, meta?: LearnLangMeta | null): LearnCatalogCourse[] {
  return LEARN_COURSES.filter((c) => courseMeta(c, lang, meta));
}

export function coursesBySection(
  lang: string,
  meta?: LearnLangMeta | null,
): { topic: string; courses: LearnCatalogCourse[] }[] {
  const available = coursesForLanguage(lang, meta);
  return SECTION_ORDER.map((topic) => ({
    topic,
    courses: available
      .filter((c) => c.topic === topic)
      .sort((a, b) => a.code.localeCompare(b.code)),
  })).filter((section) => section.courses.length > 0);
}

export function tutorialsByCategory(
  lang: string,
  meta?: LearnLangMeta | null,
): { category: string; tutorials: LearnCatalogTutorial[] }[] {
  const grouped = new Map<string, LearnCatalogTutorial[]>();
  for (const tutorial of LEARN_TUTORIALS) {
    if (!tutorialMeta(tutorial, lang, meta)) continue;
    const list = grouped.get(tutorial.category) ?? [];
    list.push(tutorial);
    grouped.set(tutorial.category, list);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, tutorials]) => ({
      category,
      tutorials: tutorials.sort((a, b) =>
        (tutorialMeta(a, lang, meta)?.name ?? a.slug).localeCompare(tutorialMeta(b, lang, meta)?.name ?? b.slug),
      ),
    }));
}

export function findCourse(code: string): LearnCatalogCourse | undefined {
  return LEARN_COURSES.find((c) => c.code === code);
}

export function findTutorial(category: string, slug: string): LearnCatalogTutorial | undefined {
  return LEARN_TUTORIALS.find((t) => t.category === category && t.slug === slug);
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export interface LearnSearchResults {
  courses: LearnCatalogCourse[];
  tutorials: LearnCatalogTutorial[];
}

export function searchCatalog(
  lang: string,
  query: string,
  meta?: LearnLangMeta | null,
): LearnSearchResults {
  const q = normalize(query.trim());
  if (q.length < 2) return { courses: [], tutorials: [] };
  const courses = coursesForLanguage(lang, meta).filter((c) => {
    const m = courseMeta(c, lang, meta);
    return (
      normalize(c.code).includes(q) ||
      normalize(m?.name ?? '').includes(q) ||
      normalize(m?.goal ?? '').includes(q)
    );
  });
  const tutorials = LEARN_TUTORIALS.filter((t) => {
    const m = tutorialMeta(t, lang, meta);
    if (!m) return false;
    return normalize(m.name).includes(q) || normalize(m.description).includes(q);
  });
  return { courses: courses.slice(0, 12), tutorials: tutorials.slice(0, 12) };
}
