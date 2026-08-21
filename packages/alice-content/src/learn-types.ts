// Types for the Learn surface (Plan B Academy corpus).
// The catalog (small, bundled) is generated into ./generated/planb-learn-catalog.ts;
// full course/tutorial packs (heavy, lazy-loaded) are generated as JSON under
// packages/alice-content/generated/learn/<lang>/.

// Values observed in course.yml across the corpus (commit 86c147e5):
// bitcoin, business, mining, protocol, security, "social studies".
export type LearnTopic =
  | 'bitcoin'
  | 'business'
  | 'mining'
  | 'protocol'
  | 'security'
  | 'social studies';

export type LearnLevel = 'beginner' | 'intermediate' | 'expert' | 'wizard';

export interface LearnLanguage {
  lang: string;
  /** Number of courses available in this language, out of the full catalog. */
  courses: number;
}

export interface LearnCourseI18n {
  name: string;
  goal: string;
  objectives: string[];
}

export interface LearnCatalogCourse {
  /**
   * How the local thumbnail was processed at ingestion: 'art' floats on the
   * card (backdrop keyed out, safe to colour-invert in dark mode), 'photo'
   * must be shown as-is in a framed tile.
   */
  thumbKind?: 'art' | 'art-dark' | 'photo' | string;
  code: string;
  courseId: string | null;
  topic: LearnTopic | string;
  level: LearnLevel | string;
  type: 'theory' | 'practice' | string;
  hours: number | null;
  /** Whitelisted languages this course exists in. */
  languages: string[];
  /** Metadata for embedded languages only (fr, en). */
  i18n: Partial<Record<string, LearnCourseI18n>>;
  chapterCount: Partial<Record<string, number>>;
  quizCount: Partial<Record<string, number>>;
}

export interface LearnCatalogTutorial {
  /** Same semantics as LearnCatalogCourse.thumbKind, for the cover. */
  thumbKind?: 'art' | 'art-dark' | 'photo' | string;
  id: string | null;
  slug: string;
  category: string;
  subcategory: string | null;
  level: string | null;
  languages: string[];
  i18n: Partial<Record<string, { name: string; description: string }>>;
}

export interface LearnChapter {
  chapterId: string | null;
  title: string;
  videoIds: string[];
  /** Raw PlanB markdown; rendering (images, video directives, anchors) happens in the app. */
  markdown: string;
}

export interface LearnPart {
  partId: string | null;
  title: string;
  chapters: LearnChapter[];
}

export interface LearnCoursePack {
  code: string;
  lang: string;
  commit: string;
  name: string;
  goal: string;
  objectives: string[];
  /** Base URL to resolve relative image paths against (raw.githubusercontent, pinned commit). */
  assetBase: string;
  /** videoId → { languageCode → youtube video id } */
  videos: Record<string, Record<string, string>>;
  intro: string;
  parts: LearnPart[];
}

export interface LearnQuizQuestion {
  id: string;
  chapterId: string;
  difficulty: string;
  question: string;
  answer: string;
  wrongAnswers: string[];
  explanation: string;
  reviewed: boolean;
}

export interface LearnTutorialPack {
  slug: string;
  category: string;
  lang: string;
  commit: string;
  name: string;
  description: string;
  assetBase: string;
  markdown: string;
}
