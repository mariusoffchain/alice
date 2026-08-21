// One stored width for every Ask-Alice dock (Explorer, Learn, Playground):
// the panel is conceptually the same docked companion, so resizing it in one
// section resizes it everywhere.

const KEY = 'alice.ask-width';
export const ASK_WIDTH_MIN = 320;
export const ASK_WIDTH_MAX = 680;
export const ASK_WIDTH_DEFAULT = 420;

export function clampAskWidth(width: number): number {
  return Math.min(ASK_WIDTH_MAX, Math.max(ASK_WIDTH_MIN, width));
}

export function loadAskWidth(): number {
  if (typeof window === 'undefined') return ASK_WIDTH_DEFAULT;
  try {
    const w = parseInt(window.localStorage.getItem(KEY) ?? '', 10);
    return Number.isFinite(w) ? clampAskWidth(w) : ASK_WIDTH_DEFAULT;
  } catch {
    return ASK_WIDTH_DEFAULT;
  }
}

export function saveAskWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, String(width));
  } catch {
    // Best effort; the panel just reopens at the default width.
  }
}
