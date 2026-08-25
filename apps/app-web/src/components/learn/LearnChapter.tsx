'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LearnCoursePack } from '@alice-wallet/alice-content/src/learn-types';
import { anchorsForChapter } from '@alice-wallet/alice-content/src/learn-anchors';
import { buildSelectionAsk, requestLearnAsk } from '@/lib/learn/ask';
import { openAnchorInExplorer } from '@/lib/learn/explorer-link';
import { playgroundBridgeFor } from '@/lib/learn/playground-suggest';
import { requestPlaygroundView } from '@/lib/playground-open';
import type { LearnLang } from '@/lib/learn/language';
import { openExternalUrl } from '@/lib/open-external';
import { annotateAnchors, parseMarkdown } from '@/lib/learn/markdown';
import { fetchCoursePack } from '@/lib/learn/packs';
import type { LearnView } from '@/lib/learn/route';
import { consumeLearnScroll, learnScroller, saveLearnScroll } from '@/lib/learn/scroll';
import { LearnMarkdown } from './LearnMarkdown';

const ui = (lang: string): 'fr' | 'en' => (lang === 'fr' ? 'fr' : 'en');


// Floating "ask Alice" affordance on text selection inside the chapter body.
// The rescue is friction-driven by design: no summarize-the-chapter button,
// only "I did not get this exact passage".
function useSelectionAsk(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [ask, setAsk] = useState<{ text: string; top: number; left: number } | null>(null);

  const update = useCallback(() => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed) {
      setAsk(null);
      return;
    }
    const text = selection.toString().trim();
    if (text.length < 12 || text.length > 1200) {
      setAsk(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setAsk(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setAsk({ text, top: rect.top, left: rect.left + rect.width / 2 });
  }, [containerRef]);

  useEffect(() => {
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [update]);

  return ask;
}

export function LearnChapter({
  code,
  chapterId,
  lang,
  onNavigate,
  onChapterRead,
  onMeta,
}: {
  code: string;
  chapterId: string;
  lang: LearnLang;
  onNavigate: (view: LearnView) => void;
  onChapterRead: (courseCode: string, chapterId: string) => void;
  /** Feeds the workspace's sticky header (formation, chapter, progress). */
  onMeta?: (meta: { courseName: string; chapterTitle: string; index: number; total: number } | null) => void;
}) {
  const router = useRouter();
  const [pack, setPack] = useState<LearnCoursePack | null>(null);
  const [error, setError] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const ask = useSelectionAsk(bodyRef);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetchCoursePack(lang, code)
      .then((p) => { if (!cancelled) setPack(p); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [lang, code]);

  useEffect(() => {
    onChapterRead(code, chapterId);
    // Reading position is per chapter opening, not per scroll.
  }, [code, chapterId, onChapterRead]);

  useEffect(() => {
    if (!pack) return;
    const all = pack.parts.flatMap((part) => part.chapters);
    const at = all.findIndex((chapter) => chapter.chapterId === chapterId);
    if (at === -1) return;
    onMeta?.({
      courseName: pack.name,
      chapterTitle: all[at].title,
      index: at + 1,
      total: all.length,
    });
  }, [pack, chapterId, onMeta]);
  useEffect(() => () => onMeta?.(null), [onMeta]);

  // Coming back from the Explorer restores the reading position saved when
  // the anchor was clicked; any other arrival starts at the top.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!pack || restored.current === chapterId) return;
    restored.current = chapterId;
    const saved = consumeLearnScroll(chapterId);
    learnScroller()?.scrollTo(0, saved ?? 0);
  }, [pack, chapterId]);

  if (error) {
    return (
      <div style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '48px 0' }}>
        <p className="font-numbers" style={{ color: 'var(--alice-muted)' }}>
          {lang === 'fr' ? 'Chapitre indisponible dans cette langue.' : 'Chapter unavailable in this language.'}
        </p>
      </div>
    );
  }
  if (!pack) {
    return (
      <div style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '48px 0' }}>
        <p className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-muted)' }}>LOADING…</p>
      </div>
    );
  }

  const flat = pack.parts.flatMap((part) => part.chapters.map((chapter) => ({ part, chapter })));
  const index = flat.findIndex((entry) => entry.chapter.chapterId === chapterId);
  const current = index >= 0 ? flat[index] : null;
  if (!current) {
    return (
      <div style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '48px 0' }}>
        <p className="font-numbers" style={{ color: 'var(--alice-muted)' }}>
          {lang === 'fr' ? 'Chapitre introuvable.' : 'Chapter not found.'}
        </p>
      </div>
    );
  }
  const previous = index > 0 ? flat[index - 1] : null;
  const next = index < flat.length - 1 ? flat[index + 1] : null;

  // Inline anchors: the first mention of a curated on-chain object becomes a
  // highlighted click into the Explorer; anchors whose text is not found in
  // this translation keep the end-of-chapter card as fallback.
  const anchors = anchorsForChapter(chapterId);
  const matchers = anchors
    .filter((a) => a.match?.[ui(lang)])
    .map((a) => ({ id: `${a.type}:${a.id}`, text: a.match![ui(lang)] }));
  const { blocks: annotatedBlocks, matched } = annotateAnchors(
    parseMarkdown(current.chapter.markdown),
    matchers,
  );
  const unmatchedAnchors = anchors.filter((a) => !matched.has(`${a.type}:${a.id}`));
  const openAnchor = (anchorId: string) => {
    const anchor = anchors.find((a) => `${a.type}:${a.id}` === anchorId);
    if (!anchor) return;
    saveLearnScroll(chapterId);
    openAnchorInExplorer(anchor, ui(lang), code, (path) => router.push(path));
  };
  const isLastOfPart =
    current.part.partId &&
    current.part.chapters[current.part.chapters.length - 1]?.chapterId === chapterId;

  const navButton: React.CSSProperties = {
    fontSize: 8,
    padding: '10px 14px',
    background: 'transparent',
    color: 'var(--alice-text)',
    border: '2px solid var(--alice-border)',
    borderRadius: 2,
    maxWidth: '48%',
    textAlign: 'left',
  };

  return (
    <div style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '24px 0 72px' }}>
      <div className="font-pixel" style={{ fontSize: 8, color: 'var(--alice-muted)' }}>
        {code.toUpperCase()} · {current.part.title.toUpperCase()}
      </div>
      <h1 className="font-pixel" style={{ fontSize: 14, lineHeight: '24px', margin: '14px 0 6px', color: 'var(--alice-text)' }}>
        {current.chapter.title}
      </h1>

      <div ref={bodyRef}>
        <LearnMarkdown
          markdown={current.chapter.markdown}
          blocks={annotatedBlocks}
          assetBase={pack.assetBase}
          videos={pack.videos}
          lang={lang}
          onAnchorClick={openAnchor}
        />
      </div>

      {ask && (
        <button
          className="font-pixel cursor-pointer"
          style={{
            position: 'fixed',
            top: Math.max(8, ask.top - 40),
            left: ask.left,
            transform: 'translateX(-50%)',
            zIndex: 20,
            fontSize: 8,
            padding: '8px 12px',
            background: 'var(--alice-primary)',
            color: 'var(--alice-on-primary)',
            border: 0,
            borderRadius: 2,
            boxShadow: '0 2px 0 var(--alice-primary-dark)',
          }}
          onClick={() => {
            // Opens the Ask-Alice sidebar with the passage attached: the
            // chapter stays on screen while Alice explains.
            requestLearnAsk(buildSelectionAsk(lang, code, current.chapter.title, ask.text));
            window.getSelection()?.removeAllRanges();
          }}
        >
          {lang === 'fr' ? 'JE N’AI PAS COMPRIS ÇA → ALICE' : 'I DID NOT GET THIS → ALICE'}
        </button>
      )}

      <AnchorCards anchors={unmatchedAnchors} chapterId={chapterId} code={code} lang={lang} />

      <PlaygroundBridge code={code} title={current.chapter.title} lang={lang} chapterId={chapterId} />

      <div className="flex items-center justify-between gap-3" style={{ marginTop: 40 }}>
        {previous?.chapter.chapterId ? (
          <button
            className="font-pixel cursor-pointer"
            style={navButton}
            onClick={() => onNavigate({ kind: 'chapter', code, chapterId: previous.chapter.chapterId! })}
          >
            ← {previous.chapter.title.toUpperCase()}
          </button>
        ) : (
          <span />
        )}
        {isLastOfPart && current.part.partId ? (
          <button
            className="font-pixel cursor-pointer"
            style={{ ...navButton, color: 'var(--alice-on-primary)', background: 'var(--alice-primary)', border: 0 }}
            onClick={() => onNavigate({ kind: 'quiz', code, partId: current.part.partId! })}
          >
            {lang === 'fr' ? 'QUIZ DE LA PARTIE →' : 'PART QUIZ →'}
          </button>
        ) : next?.chapter.chapterId ? (
          <button
            className="font-pixel cursor-pointer"
            style={{ ...navButton, textAlign: 'right' }}
            onClick={() => onNavigate({ kind: 'chapter', code, chapterId: next.chapter.chapterId! })}
          >
            {next.chapter.title.toUpperCase()} →
          </button>
        ) : (
          <span />
        )}
      </div>

      <p className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)', marginTop: 32 }}>
        {lang === 'fr' ? 'Contenu ' : 'Content by '}
        <a href="https://planb.network" target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); void openExternalUrl('https://planb.network'); }} style={{ color: 'var(--alice-muted)', textDecoration: 'underline' }}>
          Plan ₿ Academy
        </a>
        {' · CC BY-SA 4.0'}
      </p>
    </div>
  );
}

// The Learn → Playground bridge: a practical chapter (send, receive, backup,
// coins) ends on an invitation to actually do the thing, with training sats.
// The mapping is the hand-curated playgroundBridgeFor; theory chapters render
// nothing here.
function PlaygroundBridge({
  code,
  title,
  lang,
  chapterId,
}: {
  code: string;
  title: string;
  lang: LearnLang;
  chapterId: string;
}) {
  const router = useRouter();
  const view = playgroundBridgeFor(code, title);
  if (!view) return null;
  return (
    <div style={{ marginTop: 28 }}>
      <button
        className="font-pixel cursor-pointer"
        style={{
          fontSize: 8,
          padding: '12px 16px',
          background: 'var(--alice-primary)',
          color: 'var(--alice-on-primary)',
          border: 0,
          borderRadius: 2,
        }}
        onClick={() => {
          saveLearnScroll(chapterId);
          requestPlaygroundView(view);
          router.push('/playground');
        }}
      >
        {ui(lang) === 'fr' ? 'ESSAYER DANS LE PLAYGROUND →' : 'TRY IT IN THE PLAYGROUND →'}
      </button>
    </div>
  );
}

// Editorial anchors: the chapter talks about a real on-chain object, the card
// opens it in the Explorer (as a normal Explorer tab). Curated per chapterId in
// alice-content/learn-anchors, so most chapters simply render nothing here.
function AnchorCards({
  anchors,
  chapterId,
  code,
  lang,
}: {
  anchors: ReturnType<typeof anchorsForChapter>;
  chapterId: string;
  code: string;
  lang: LearnLang;
}) {
  const router = useRouter();
  if (anchors.length === 0) return null;
  return (
    <div style={{ marginTop: 32 }}>
      <div className="font-pixel" style={{ fontSize: 8, color: 'var(--alice-muted)', marginBottom: 10 }}>
        {lang === 'fr' ? 'À VOIR SUR LA CHAÎNE' : 'SEE IT ON CHAIN'}
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {anchors.map((anchor) => (
          <button
            key={`${anchor.type}:${anchor.id}`}
            onClick={() => {
              saveLearnScroll(chapterId);
              openAnchorInExplorer(anchor, ui(lang), code, (path) => router.push(path));
            }}
            className="text-left cursor-pointer transition-colors hover:bg-white/5"
            style={{
              border: '2px solid var(--alice-primary)',
              borderRadius: 2,
              background: 'var(--alice-bg-soft)',
              color: 'var(--alice-text)',
              padding: '12px 14px',
            }}
          >
            <div className="font-pixel" style={{ fontSize: 7, color: 'var(--alice-primary)' }}>
              {anchor.type === 'block' ? `BLOCK ${anchor.id}` : anchor.type.toUpperCase()}
            </div>
            <div className="font-numbers" style={{ fontSize: 14, marginTop: 8, lineHeight: '21px' }}>
              {anchor.label[ui(lang)]}
            </div>
            <div className="font-pixel" style={{ fontSize: 7, color: 'var(--alice-muted)', marginTop: 10 }}>
              {lang === 'fr' ? 'VOIR DANS L’EXPLORER →' : 'SEE IN THE EXPLORER →'}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
