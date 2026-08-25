'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauriDesktop, recordCourseCompletionSignal, recordCourseStudySignal } from '@alice-wallet/alice-ai';
import { AskAliceFab } from '@/components/AskAliceFab';
import { Sidebar, SIDEBAR_ICON_SVG } from '@/components/Sidebar';
import { SvgIcon } from '@/components/SvgIcon';
import { LearnAskAlice } from '@/components/learn/LearnAskAlice';
import { LearnChapter } from '@/components/learn/LearnChapter';
import { LearnCourse } from '@/components/learn/LearnCourse';
import { LearnHome } from '@/components/learn/LearnHome';
import { LearnIntroModal, wasLearnIntroDismissed } from '@/components/learn/LearnIntroModal';
import { LearnLanguageModal } from '@/components/learn/LearnLanguageModal';
import { LearnQuiz } from '@/components/learn/LearnQuiz';
import { LearnTutorial } from '@/components/learn/LearnTutorial';
import { ASK_WIDTH_DEFAULT, clampAskWidth, loadAskWidth, saveAskWidth } from '@/lib/ask-width';
import {
  defaultLearnLanguage,
  installedLanguages,
  loadLearnLanguage,
  saveLearnLanguage,
  type LearnLang,
} from '@/lib/learn/language';
import { loadLangMeta, type LearnLangMeta } from '@/lib/learn/lang-meta';
import {
  loadProgress,
  markChapterRead,
  readCount,
  saveProgress,
  type LearnProgress,
} from '@/lib/learn/progress';
import { conceptsForCourse } from '@/lib/learn/course-concepts';
import { courseChapterCount } from '@/lib/learn/catalog';
import { LEARN_COURSES } from '@alice-wallet/alice-content/src/generated/planb-learn-catalog';
import { LEARN_ASK_EVENT } from '@/lib/learn/ask';
import { LEARN_RESET_EVENT, learnViewToSearch, parseLearnView, type LearnView } from '@/lib/learn/route';

const ASK_OPEN_KEY = 'alice.learn.ask-open';

// A speech-bubble/globe hybrid in the pixel grammar: rounded world with a
// horizontal band, reads as "language" next to the reading controls.
const LANG_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="5" y="1" width="6" height="2" fill="{{COLOR}}"/>
  <rect x="3" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="11" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="5" width="2" height="6" fill="{{COLOR}}"/>
  <rect x="13" y="5" width="2" height="6" fill="{{COLOR}}"/>
  <rect x="4" y="7" width="8" height="2" fill="{{COLOR}}" fill-opacity="0.55"/>
  <rect x="3" y="11" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="11" y="11" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="5" y="13" width="6" height="2" fill="{{COLOR}}"/>
</svg>`;

function LearnWorkspace() {
  // Start on home so server and first client render agree; the deep-linked
  // view and stored preferences come in after hydration, the repo's idiom for
  // static export (no useSearchParams, no Suspense).
  const [view, setView] = useState<LearnView>({ kind: 'home' });
  const [lang, setLang] = useState<LearnLang>('en');
  const [progress, setProgress] = useState<LearnProgress>({});
  // The Ask-Alice sidebar, Explorer-style. Never opens on its own: the user
  // asks for it (bubble, quiz debrief, selection rescue), and entering Learn
  // always starts with the reading full-width.
  const [askOpen, setAskOpen] = useState(false);
  const [askWidth, setAskWidth] = useState(ASK_WIDTH_DEFAULT);
  // Reported by the chapter reader so the sticky header can show where the
  // reader is (formation, chapter, progress) while the text scrolls.
  const [chapterMeta, setChapterMeta] = useState<{
    courseName: string;
    chapterTitle: string;
    index: number;
    total: number;
  } | null>(null);
  // Downloadable-language support: the quick toggle lists installed languages,
  // and non-embedded languages need their translated metadata overlay.
  const [installed, setInstalled] = useState<LearnLang[]>(['fr', 'en']);
  const [langModalOpen, setLangModalOpen] = useState(false);
  // Welcome dialog, Explorer-style: shown on every mount of the section until
  // the reader ticks "don't show this again". Decided after hydration since it
  // reads localStorage.
  const [showIntro, setShowIntro] = useState(false);
  const [langMeta, setLangMeta] = useState<LearnLangMeta | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    setView(parseLearnView(window.location.search));
    setLang(loadLearnLanguage() ?? defaultLearnLanguage(navigator.language));
    setInstalled(installedLanguages());
    setProgress(loadProgress());
    setAskWidth(loadAskWidth());
    // Same memory as Explorer and the Playground: reopening Learn with the
    // dock open is a per-section choice, only the width is shared.
    try { setAskOpen(window.localStorage.getItem(ASK_OPEN_KEY) === 'true'); } catch { /* default closed */ }
    setShowIntro(!wasLearnIntroDismissed());
    hydrated.current = true;
    const onPop = () => setView(parseLearnView(window.location.search));
    // The sidebar's Learn entry always lands on the dashboard, even when the
    // panel is already mounted on a course or chapter.
    const onReset = () => {
      setView({ kind: 'home' });
      document.getElementById('learn-scroll')?.scrollTo(0, 0);
    };
    // Quiz debriefs and selection rescues open the Ask-Alice sidebar in
    // place (the course stays in view); the request itself is consumed by
    // the panel component.
    const onAsk = () => setAskOpen(true);
    window.addEventListener('popstate', onPop);
    window.addEventListener(LEARN_RESET_EVENT, onReset);
    window.addEventListener(LEARN_ASK_EVENT, onAsk);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener(LEARN_RESET_EVENT, onReset);
      window.removeEventListener(LEARN_ASK_EVENT, onAsk);
    };
  }, []);

  const navigate = useCallback((next: LearnView) => {
    setView(next);
    window.history.pushState(null, '', `/learn/${learnViewToSearch(next)}`);
    document.getElementById('learn-scroll')?.scrollTo(0, 0);
  }, []);

  const changeLang = useCallback((next: LearnLang) => {
    setLang(next);
    saveLearnLanguage(next);
    setInstalled(installedLanguages());
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLangMeta(lang)
      .then((meta) => { if (!cancelled) setLangMeta(meta); })
      .catch(() => { if (!cancelled) setLangMeta(null); });
    return () => { cancelled = true; };
  }, [lang]);

  const toggleAsk = useCallback((open: boolean) => {
    setAskOpen(open);
  }, []);

  useEffect(() => {
    if (hydrated.current) saveAskWidth(askWidth);
  }, [askWidth]);

  useEffect(() => {
    if (!hydrated.current) return;
    try { window.localStorage.setItem(ASK_OPEN_KEY, String(askOpen)); } catch { /* best effort */ }
  }, [askOpen]);

  // Drag the sidebar's left edge to resize it (desktop only), Explorer-style.
  function startAskResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = askWidth;
    const move = (ev: PointerEvent) => {
      setAskWidth(clampAskWidth(startW + (startX - ev.clientX)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const onChapterRead = useCallback((courseCode: string, chapterId: string) => {
    setProgress((current) => {
      const next = markChapterRead(current, courseCode, chapterId, Date.now());
      saveProgress(next);

      // The bridge from Learn to the pedagogical profile. A read chapter is a
      // study signal for the course's concepts; the chapter that completes
      // the course sets their familiarity outright, because working through
      // a whole course says more about someone than any question they typed.
      // Fired only on the transition into 'finished' so revisiting a chapter
      // never re-triggers it, and fire-and-forget: a profile write must never
      // be able to break reading.
      const concepts = conceptsForCourse(courseCode);
      if (concepts.length > 0) {
        const wasRead = Boolean(current[courseCode]?.readChapters?.[chapterId]);
        if (!wasRead) {
          const course = LEARN_COURSES.find(c => c.code === courseCode);
          const total = course ? courseChapterCount(course, lang, langMeta) : 0;
          const read = readCount(next, courseCode);
          if (course && total > 0 && read >= total && readCount(current, courseCode) < total) {
            void recordCourseCompletionSignal(concepts, String(course.level ?? '')).catch(() => {});
          } else {
            void recordCourseStudySignal(concepts).catch(() => {});
          }
        }
      }
      return next;
    });
  }, [lang, langMeta]);

  return (
    <div className="flex flex-1 min-h-0 min-w-0">
    <div id="learn-scroll" className="flex-1 min-h-0 overflow-y-auto">
      <header
        className="flex items-center flex-wrap"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 15,
          background: 'var(--alice-bg)',
          width: '100%',
          margin: 0,
          columnGap: 18,
          rowGap: 10,
          padding: '12px max(16px, calc((100% - 1100px) / 2)) 12px',
          borderBottom: '1px solid var(--alice-border)',
        }}
      >
        {view.kind !== 'home' && (
          <button
            onClick={() => {
              if (view.kind === 'chapter' || view.kind === 'quiz') navigate({ kind: 'course', code: view.code });
              else navigate({ kind: 'home' });
            }}
            className="font-pixel cursor-pointer"
            style={{ fontSize: 8, color: 'var(--alice-muted)', background: 'none', border: 0, padding: 0 }}
          >
            {view.kind === 'chapter' || view.kind === 'quiz' ? '← COURSE' : '← BACK'}
          </button>
        )}
        {view.kind === 'chapter' && chapterMeta && (
          <div className="flex items-center gap-4 min-w-0 flex-1" style={{ minWidth: 220 }}>
            <div className="min-w-0">
              <div className="font-pixel truncate" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
                {chapterMeta.courseName.toUpperCase()}
              </div>
              <div className="font-numbers truncate" style={{ fontSize: 13, color: 'var(--alice-text)' }}>
                {chapterMeta.chapterTitle}
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 shrink-0" aria-label="Course progress">
              <div style={{ display: 'flex', gap: 2, width: 90 }}>
                {Array.from({ length: 12 }, (_, i) => (
                  <span
                    key={i}
                    style={{
                      flex: 1,
                      height: 5,
                      background:
                        i < Math.round((chapterMeta.index / Math.max(chapterMeta.total, 1)) * 12)
                          ? 'var(--alice-primary)'
                          : 'var(--alice-border)',
                    }}
                  />
                ))}
              </div>
              <span className="font-pixel" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
                {chapterMeta.index}/{chapterMeta.total}
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0" style={{ marginLeft: 'auto' }}>
          <div
            role="group"
            aria-label="Reading language"
            className="flex"
            style={{ border: '2px solid var(--alice-border)', borderRadius: 2 }}
          >
            {installed.map((code) => (
              <button
                key={code}
                aria-pressed={lang === code}
                onClick={() => changeLang(code)}
                className="font-pixel cursor-pointer"
                style={{
                  fontSize: 8,
                  padding: '8px 12px',
                  border: 0,
                  background: lang === code ? 'var(--alice-primary)' : 'transparent',
                  color: lang === code ? 'var(--alice-on-primary)' : 'var(--alice-muted)',
                }}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLangModalOpen(true)}
            aria-label="All course languages"
            className="flex items-center justify-center cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
            style={{ width: 34, height: 32, border: '2px solid var(--alice-border)', borderRadius: 2, background: 'transparent' }}
          >
            <SvgIcon svg={LANG_ICON_SVG} size={16} color="var(--alice-primary)" />
          </button>
        </div>
      </header>

      {showIntro && (
        <LearnIntroModal
          lang={lang}
          onClose={() => setShowIntro(false)}
          onPickLanguage={() => setLangModalOpen(true)}
        />
      )}

      {langModalOpen && (
        <LearnLanguageModal
          currentLang={lang}
          onSelect={changeLang}
          onClose={() => setLangModalOpen(false)}
        />
      )}

      {view.kind === 'home' && <LearnHome lang={lang} meta={langMeta} progress={progress} onNavigate={navigate} />}
      {view.kind === 'course' && (
        <LearnCourse code={view.code} lang={lang} progress={progress} onNavigate={navigate} />
      )}
      {view.kind === 'chapter' && (
        <LearnChapter
          code={view.code}
          chapterId={view.chapterId}
          lang={lang}
          onNavigate={navigate}
          onChapterRead={onChapterRead}
          onMeta={setChapterMeta}
        />
      )}
      {view.kind === 'quiz' && (
        <LearnQuiz code={view.code} partId={view.partId} lang={lang} onNavigate={navigate} />
      )}
      {view.kind === 'tutorial' && (
        <LearnTutorial category={view.category} slug={view.slug} lang={lang} />
      )}
    </div>

    {askOpen ? (
      <aside
        className="fixed inset-0 z-40 md:relative md:z-auto md:shrink-0 md:min-h-0 md:w-[var(--ask-w,420px)]"
        style={{ ['--ask-w' as string]: `${askWidth}px`, backgroundColor: 'var(--alice-bg-soft)' } as React.CSSProperties}
      >
        <div
          onPointerDown={startAskResize}
          className="hidden md:block absolute left-0 inset-y-0 z-10"
          style={{ width: 5, cursor: 'col-resize' }}
          aria-hidden="true"
        />
        <LearnAskAlice view={view} lang={lang} onClose={() => toggleAsk(false)} />
      </aside>
    ) : (
      <AskAliceFab onOpen={() => toggleAsk(true)} />
    )}
    </div>
  );
}

export function LearnPanel() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: 'var(--alice-bg)' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        mobileOpen={sidebarMobileOpen}
        onMobileClose={() => setSidebarMobileOpen(false)}
      />

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {isTauriDesktop() && (
          <div data-tauri-drag-region className="shrink-0" style={{ height: 28 }} />
        )}
        <div
          className="grid shrink-0 grid-cols-[108px_minmax(0,1fr)_108px] items-center px-3 md:hidden"
          style={{
            height: 'calc(52px + env(safe-area-inset-top))',
            paddingTop: 'env(safe-area-inset-top)',
          }}
        >
          <div className="flex items-center">
            <button
              onClick={() => setSidebarMobileOpen(true)}
              className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Open menu"
            >
              <SvgIcon svg={SIDEBAR_ICON_SVG} size={18} color="var(--alice-text)" />
            </button>
          </div>
          <div className="flex min-w-0 items-center justify-center">
            <span className="font-pixel" style={{ fontSize: 11, color: 'var(--alice-text)' }}>
              Learn
            </span>
          </div>
          <div />
        </div>

        <LearnWorkspace />
      </div>
    </div>
  );
}
