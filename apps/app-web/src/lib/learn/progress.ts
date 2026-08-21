// Reading progress for Learn, persisted locally with the same validated-JSON
// pattern as lib/explorer/tab-storage.ts. Three states per chapter derive the
// course-level state: never seen / started / finished.
const STORAGE_KEY = 'alice.learn.progress.v1';

export interface CourseProgress {
  /** chapterId → true once the chapter has been opened. */
  readChapters: Record<string, true>;
  /** Last chapter opened, for the resume button. */
  lastChapterId: string | null;
  updatedAt: number;
}

export type LearnProgress = Record<string, CourseProgress>;

export type CourseState = 'new' | 'started' | 'finished';

function isValidCourseProgress(value: unknown): value is CourseProgress {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.readChapters !== 'object' || v.readChapters === null) return false;
  if (v.lastChapterId !== null && typeof v.lastChapterId !== 'string') return false;
  return typeof v.updatedAt === 'number';
}

export function parseProgress(raw: string | null): LearnProgress {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: LearnProgress = {};
    for (const [code, value] of Object.entries(parsed)) {
      if (isValidCourseProgress(value)) result[code] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function loadProgress(): LearnProgress {
  if (typeof window === 'undefined') return {};
  try {
    return parseProgress(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

export function saveProgress(progress: LearnProgress): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Best-effort.
  }
}

export function markChapterRead(
  progress: LearnProgress,
  courseCode: string,
  chapterId: string,
  now: number,
): LearnProgress {
  const current = progress[courseCode] ?? { readChapters: {}, lastChapterId: null, updatedAt: 0 };
  return {
    ...progress,
    [courseCode]: {
      readChapters: { ...current.readChapters, [chapterId]: true },
      lastChapterId: chapterId,
      updatedAt: now,
    },
  };
}

export function courseState(
  progress: LearnProgress,
  courseCode: string,
  totalChapters: number,
): CourseState {
  const course = progress[courseCode];
  const read = course ? Object.keys(course.readChapters).length : 0;
  if (read === 0) return 'new';
  return totalChapters > 0 && read >= totalChapters ? 'finished' : 'started';
}

export function readCount(progress: LearnProgress, courseCode: string): number {
  const course = progress[courseCode];
  return course ? Object.keys(course.readChapters).length : 0;
}

/** Courses to surface in the home "Resume" block, most recent first. */
export function resumeList(
  progress: LearnProgress,
  totalChaptersByCode: (code: string) => number,
): { courseCode: string; lastChapterId: string | null; read: number }[] {
  return Object.entries(progress)
    .filter(([code, p]) => {
      const read = Object.keys(p.readChapters).length;
      const total = totalChaptersByCode(code);
      return read > 0 && (total === 0 || read < total);
    })
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .map(([courseCode, p]) => ({
      courseCode,
      lastChapterId: p.lastChapterId,
      read: Object.keys(p.readChapters).length,
    }));
}
