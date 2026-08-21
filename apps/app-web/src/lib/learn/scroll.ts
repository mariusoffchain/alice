// Reading-position memory for the Learn scroll container: leaving a chapter
// for the Explorer (inline anchor, card) saves the position, coming back
// restores it once. Session-scoped: a fresh app start reads from the top.
const SCROLLER_ID = 'learn-scroll';
const key = (chapterId: string) => `learn.scroll.${chapterId}`;

export function learnScroller(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById(SCROLLER_ID);
}

export function saveLearnScroll(chapterId: string): void {
  const el = learnScroller();
  if (!el) return;
  try {
    sessionStorage.setItem(key(chapterId), String(el.scrollTop));
  } catch {
    // Best-effort.
  }
}

export function consumeLearnScroll(chapterId: string): number | null {
  try {
    const raw = sessionStorage.getItem(key(chapterId));
    if (raw === null) return null;
    sessionStorage.removeItem(key(chapterId));
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
