'use client';

import { useEffect, useState } from 'react';
import type { LearnCoursePack } from '@alice-wallet/alice-content/src/learn-types';
import { LEVEL_LABELS, findCourse } from '@/lib/learn/catalog';
import type { LearnLang } from '@/lib/learn/language';
import { fetchCoursePack } from '@/lib/learn/packs';
import type { LearnProgress } from '@/lib/learn/progress';
import type { LearnView } from '@/lib/learn/route';

const ui = (lang: string): 'fr' | 'en' => (lang === 'fr' ? 'fr' : 'en');

export function LearnCourse({
  code,
  lang,
  progress,
  onNavigate,
}: {
  code: string;
  lang: LearnLang;
  progress: LearnProgress;
  onNavigate: (view: LearnView) => void;
}) {
  const [pack, setPack] = useState<LearnCoursePack | null>(null);
  const [error, setError] = useState(false);
  const catalogEntry = findCourse(code);

  useEffect(() => {
    let cancelled = false;
    setPack(null);
    setError(false);
    fetchCoursePack(lang, code)
      .then((p) => { if (!cancelled) setPack(p); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [lang, code]);

  if (error) {
    return (
      <div style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '48px 0' }}>
        <p className="font-numbers" style={{ color: 'var(--alice-muted)' }}>
          {lang === 'fr'
            ? 'Ce cours n’est pas disponible dans cette langue pour le moment.'
            : 'This course is not available in this language yet.'}
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

  const read = progress[code]?.readChapters ?? {};
  const lastChapterId = progress[code]?.lastChapterId ?? null;
  const allChapters = pack.parts.flatMap((p) => p.chapters);
  const firstUnread = allChapters.find((c) => c.chapterId && !read[c.chapterId]);
  const resumeTarget = lastChapterId ?? firstUnread?.chapterId ?? allChapters[0]?.chapterId;
  const started = Object.keys(read).length > 0;
  const level = catalogEntry ? (LEVEL_LABELS[catalogEntry.level]?.[ui(lang)] ?? catalogEntry.level) : '';

  return (
    <div className="font-numbers" style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '24px 0 72px', color: 'var(--alice-text)' }}>
      <div className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-primary)' }}>
        {code.toUpperCase()}
        {level ? <span style={{ color: 'var(--alice-muted)' }}> · {level.toUpperCase()}</span> : null}
      </div>
      <h1 className="font-pixel" style={{ fontSize: 16, lineHeight: '26px', margin: '12px 0 0' }}>{pack.name}</h1>
      <p style={{ margin: '14px 0 0', fontSize: 16, lineHeight: '25px', color: 'var(--alice-muted)' }}>{pack.goal}</p>

      {pack.objectives.length > 0 && (
        <ul style={{ margin: '16px 0 0', paddingLeft: 20, listStyleType: 'square', color: 'var(--alice-muted)', fontSize: 14, lineHeight: '24px' }}>
          {pack.objectives.map((objective, i) => (
            <li key={i}>{objective}</li>
          ))}
        </ul>
      )}

      {resumeTarget && (
        <button
          onClick={() => onNavigate({ kind: 'chapter', code, chapterId: resumeTarget })}
          className="font-pixel cursor-pointer"
          style={{
            marginTop: 20,
            fontSize: 9,
            padding: '12px 18px',
            background: 'var(--alice-primary)',
            color: 'var(--alice-on-primary)',
            border: 0,
            borderRadius: 2,
          }}
        >
          {started ? (lang === 'fr' ? 'REPRENDRE' : 'RESUME') : (lang === 'fr' ? 'COMMENCER' : 'START')}
        </button>
      )}

      <div style={{ marginTop: 32 }}>
        {pack.parts.map((part, partIndex) => (
          <section key={part.partId ?? partIndex} style={{ marginBottom: 22 }}>
            <h2 className="font-pixel" style={{ fontSize: 9, margin: '0 0 8px', color: 'var(--alice-muted)' }}>
              {String(partIndex + 1).padStart(2, '0')} · {part.title.toUpperCase()}
            </h2>
            <div style={{ border: '2px solid var(--alice-border)', borderRadius: 2 }}>
              {part.chapters.map((chapter, chapterIndex) => {
                const isRead = chapter.chapterId ? Boolean(read[chapter.chapterId]) : false;
                const isCurrent = chapter.chapterId === lastChapterId;
                return (
                  <button
                    key={chapter.chapterId ?? chapterIndex}
                    disabled={!chapter.chapterId}
                    onClick={() =>
                      chapter.chapterId && onNavigate({ kind: 'chapter', code, chapterId: chapter.chapterId })
                    }
                    className="flex items-center gap-3 w-full text-left cursor-pointer transition-colors hover:bg-white/5"
                    style={{
                      background: 'transparent',
                      border: 0,
                      borderTop: chapterIndex > 0 ? '1px solid var(--alice-border)' : 0,
                      color: 'var(--alice-text)',
                      padding: '12px 14px',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 10,
                        height: 10,
                        flexShrink: 0,
                        borderRadius: 1,
                        border: '2px solid var(--alice-border)',
                        background: isRead ? 'var(--alice-primary)' : 'transparent',
                      }}
                    />
                    <span style={{ fontSize: 15, flex: 1 }}>{chapter.title}</span>
                    {isCurrent && (
                      <span className="font-pixel" style={{ fontSize: 7, color: 'var(--alice-primary)' }}>
                        {lang === 'fr' ? 'EN COURS' : 'CURRENT'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {part.partId && partHasQuiz(part.chapters.map((c) => c.chapterId)) && (
              <button
                onClick={() => part.partId && onNavigate({ kind: 'quiz', code, partId: part.partId })}
                className="font-pixel cursor-pointer"
                style={{
                  marginTop: 8,
                  fontSize: 8,
                  padding: '8px 12px',
                  background: 'transparent',
                  color: 'var(--alice-primary)',
                  border: '2px solid var(--alice-primary)',
                  borderRadius: 2,
                }}
              >
                {lang === 'fr' ? 'QUIZ DE LA PARTIE' : 'PART QUIZ'}
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

// The quiz pack is fetched lazily on the quiz screen; at TOC level, offering
// the button whenever the part has identifiable chapters is enough (parts
// without matching questions show an empty-quiz message instead).
function partHasQuiz(chapterIds: (string | null)[]): boolean {
  return chapterIds.some(Boolean);
}
