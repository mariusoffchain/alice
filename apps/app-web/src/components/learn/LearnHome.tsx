'use client';

import { useEffect, useRef, useState } from 'react';
import { getPedagogicalProfile } from '@alice-wallet/alice-ai';
import type { LearnCatalogCourse, LearnCatalogTutorial } from '@alice-wallet/alice-content/src/learn-types';
import { buildForYou, type ForYouEntry } from '@/lib/learn/foryou';
import {
  LEVEL_LABELS,
  SECTION_LABELS,
  TUTORIAL_CATEGORY_LABELS,
  courseChapterCount,
  courseMeta,
  courseThumbnailUrl,
  coursesBySection,
  searchCatalog,
  tutorialCoverUrl,
  tutorialMeta,
  tutorialsByCategory,
} from '@/lib/learn/catalog';
import type { LearnLangMeta } from '@/lib/learn/lang-meta';
import type { LearnLang } from '@/lib/learn/language';
import { openExternalUrl } from '@/lib/open-external';
import type { LearnProgress } from '@/lib/learn/progress';
import { readCount, resumeList } from '@/lib/learn/progress';
import type { LearnView } from '@/lib/learn/route';
import { useOnline } from './LearnMarkdown';

const ui = (lang: string): 'fr' | 'en' => (lang === 'fr' ? 'fr' : 'en');

const cardBorder: React.CSSProperties = { border: '2px solid var(--alice-border)', borderRadius: 2 };

// The pixel header with the course code doubles as the offline/error
// placeholder. Two rendering families, decided at ingestion (thumbKind):
//  - keyed drawings ('art') float on the card and are safe to smart-invert
//    in dark mode;
//  - photographic artwork ('photo', and every remote tutorial cover) is shown
//    as-is in a framed tile, never colour-inverted (a negated photo is trash).
function CardThumb({
  src,
  fallbackLabel,
  kind,
}: {
  src: string;
  fallbackLabel: string;
  kind: string;
}) {
  const online = useOnline();
  const [failed, setFailed] = useState(false);
  // Load eagerly, on purpose. The obvious lazy paths both fail here because of
  // the page's geometry, a horizontal scroller nested in a vertical one inside
  // an overflow-hidden shell: native loading="lazy" leaves currentSrc empty
  // forever, and even a hand-rolled IntersectionObserver on a plainly visible
  // card never fires against these scroll ancestors. Both were verified in the
  // running page. A thumbnail is a few kilobytes of webp; loading the catalogue
  // at once costs a brief burst of small requests, which is a real cost, but a
  // smaller one than a wall of grey placeholders that never resolve. If the
  // catalogue grows enough to matter, paginate the rows rather than trusting
  // viewport detection that this layout defeats.
  if (!online || failed) {
    return (
      <div
        className="font-pixel flex items-center justify-center"
        style={{ background: 'var(--alice-bg-soft)', height: 140, fontSize: 10, color: 'var(--alice-primary)' }}
      >
        {fallbackLabel}
      </div>
    );
  }
  if (kind === 'photo') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        // 'contain' over 'cover': banners and logos must never be cropped;
        // off-ratio images are letterboxed on the card background instead.
        style={{
          display: 'block',
          width: '100%',
          height: 140,
          objectFit: 'contain',
          padding: '8px 10px',
          boxSizing: 'border-box',
        }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      // No background here: the filter would invert it along with the artwork.
      // 'art' was drawn on a light page → invert in dark mode;
      // 'art-dark' was drawn on a dark banner → invert in light mode.
      style={{
        display: 'block',
        width: '100%',
        height: 140,
        objectFit: 'contain',
        padding: '12px 14px 6px',
        boxSizing: 'border-box',
        filter:
          kind === 'art-dark'
            ? 'var(--alice-media-invert-light, none)'
            : 'var(--alice-media-invert, none)',
      }}
    />
  );
}

// Horizontal rail with side arrows, PlanB-style. Arrows scroll by most of a
// viewport; the rail itself stays natively scrollable (trackpad, touch).
function CarouselRow({ children }: { children: React.ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  const scrollBy = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: 'smooth' });
  };
  const arrow: React.CSSProperties = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 1,
    width: 28,
    height: 28,
    border: '2px solid var(--alice-border)',
    borderRadius: 2,
    background: 'var(--alice-bg)',
    color: 'var(--alice-text)',
    fontSize: 8,
  };
  return (
    <div style={{ position: 'relative' }}>
      <button
        aria-label="Scroll left"
        className="font-pixel cursor-pointer opacity-70 hover:opacity-100 transition-opacity hidden md:block"
        style={{ ...arrow, left: -12 }}
        onClick={() => scrollBy(-1)}
      >
        ←
      </button>
      <div
        ref={railRef}
        className="flex gap-3"
        style={{ overflowX: 'auto', scrollSnapType: 'x proximity', paddingBottom: 6, scrollbarWidth: 'none' }}
      >
        {children}
      </div>
      <button
        aria-label="Scroll right"
        className="font-pixel cursor-pointer opacity-70 hover:opacity-100 transition-opacity hidden md:block"
        style={{ ...arrow, right: -12 }}
        onClick={() => scrollBy(1)}
      >
        →
      </button>
    </div>
  );
}

function CourseCard({
  course,
  lang,
  langMeta,
  progress,
  onOpen,
  fixedWidth,
}: {
  course: LearnCatalogCourse;
  lang: LearnLang;
  langMeta: LearnLangMeta | null;
  progress: LearnProgress;
  onOpen: () => void;
  fixedWidth?: boolean;
}) {
  const meta = courseMeta(course, lang, langMeta);
  const total = courseChapterCount(course, lang, langMeta);
  const read = readCount(progress, course.code);
  const level = LEVEL_LABELS[course.level]?.[ui(lang)] ?? course.level;
  return (
    <button
      onClick={onOpen}
      className="text-left cursor-pointer transition-colors hover:bg-white/5 shrink-0"
      style={{
        ...cardBorder,
        background: 'transparent',
        color: 'var(--alice-text)',
        padding: 0,
        width: fixedWidth ? 220 : '100%',
        scrollSnapAlign: 'start',
        overflow: 'hidden',
        // The row stretches every card to the tallest, and a <button> centres
        // its own content when it has room to spare. On a card whose title
        // fits one line that spare height split in two, dropping the artwork
        // by half of it and breaking the alignment of a whole row of images.
        // Stacking the content explicitly puts the slack back at the bottom,
        // where nothing lines up against anything.
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
      }}
    >
      <CardThumb
        src={courseThumbnailUrl(course.code)}
        fallbackLabel={course.code.toUpperCase()}
        kind={course.thumbKind ?? 'art'}
      />
      <div
        className="font-pixel flex items-center justify-between"
        style={{ borderTop: '2px solid var(--alice-border)', padding: '8px 12px', fontSize: 7, color: 'var(--alice-primary)' }}
      >
        <span>{course.code.toUpperCase()}</span>
        {read > 0 && (
          <span style={{ color: 'var(--alice-muted)' }}>
            {total > 0 && read >= total ? 'DONE' : `${read}/${total}`}
          </span>
        )}
      </div>
      <div style={{ padding: '4px 12px 10px' }}>
        {/* Two lines held open whatever the title needs. Titles run to one
            or two lines across the catalogue, so reserving the taller of the
            two removes the height difference that made the row stretch in the
            first place. A longer title still grows; it just no longer drags
            its neighbours' artwork down with it. */}
        <div className="font-numbers" style={{ fontSize: 15, lineHeight: '22px', minHeight: 44 }}>{meta?.name ?? course.code}</div>
        <div className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)', marginTop: 4 }}>
          {level}
          {total > 0 ? ` · ${total} ${lang === 'fr' ? 'chapitres' : 'chapters'}` : ''}
          {course.hours ? ` · ${course.hours}h` : ''}
        </div>
      </div>
    </button>
  );
}

function TutorialCard({
  tutorial,
  lang,
  langMeta,
  onOpen,
  fixedWidth,
}: {
  tutorial: LearnCatalogTutorial;
  lang: LearnLang;
  langMeta: LearnLangMeta | null;
  onOpen: () => void;
  fixedWidth?: boolean;
}) {
  const meta = tutorialMeta(tutorial, lang, langMeta);
  return (
    <button
      onClick={onOpen}
      className="text-left cursor-pointer transition-colors hover:bg-white/5 shrink-0"
      style={{
        ...cardBorder,
        background: 'transparent',
        color: 'var(--alice-text)',
        padding: 0,
        width: fixedWidth ? 190 : '100%',
        scrollSnapAlign: 'start',
        overflow: 'hidden',
        // Same stretching row, same button centring, same fix as CourseCard.
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
      }}
    >
      <CardThumb
        src={tutorialCoverUrl(tutorial.category, tutorial.slug)}
        fallbackLabel={(TUTORIAL_CATEGORY_LABELS[tutorial.category]?.[ui(lang)] ?? tutorial.category).toUpperCase()}
        kind={tutorial.thumbKind ?? 'photo'}
      />
      <div style={{ padding: '8px 12px 10px', borderTop: '2px solid var(--alice-border)' }}>
        <div className="font-numbers" style={{ fontSize: 14, lineHeight: '20px' }}>{meta?.name ?? tutorial.slug}</div>
        {meta?.description && (
          <div
            className="font-numbers"
            style={{
              fontSize: 12,
              color: 'var(--alice-muted)',
              marginTop: 4,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {meta.description}
          </div>
        )}
      </div>
    </button>
  );
}

export function LearnHome({
  lang,
  meta: langMeta,
  progress,
  onNavigate,
}: {
  lang: LearnLang;
  meta: LearnLangMeta | null;
  progress: LearnProgress;
  onNavigate: (view: LearnView) => void;
}) {
  const [query, setQuery] = useState('');
  const sections = coursesBySection(lang, langMeta);
  const tutorialGroups = tutorialsByCategory(lang, langMeta);
  const results = searchCatalog(lang, query, langMeta);
  const searching = query.trim().length >= 2;

  const totalsByCode = (code: string) => {
    const course = sections.flatMap((s) => s.courses).find((c) => c.code === code);
    return course ? courseChapterCount(course, lang, langMeta) : 0;
  };
  const resume = resumeList(progress, totalsByCode).slice(0, 3);

  // "For you": deterministic recommendations from Alice's pedagogical profile
  // (loaded async, block hidden until it has something honest to say).
  const [forYou, setForYou] = useState<ForYouEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    getPedagogicalProfile()
      .then((profile) => {
        if (cancelled) return;
        setForYou(buildForYou(profile, progress, sections.flatMap((s) => s.courses)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, lang]);
  const courseByCode = new Map(sections.flatMap((s) => s.courses).map((c) => [c.code, c]));

  return (
    <div style={{ width: 'min(100% - 32px, 1100px)', margin: '0 auto', padding: '24px 0 72px' }}>
      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 20 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={lang === 'fr' ? 'Chercher un cours, un tutoriel…' : 'Search courses and tutorials…'}
          className="font-numbers flex-1"
          style={{
            ...cardBorder,
            minWidth: 220,
            background: 'transparent',
            color: 'var(--alice-text)',
            padding: '10px 12px',
            fontSize: 14,
            outline: 'none',
          }}
        />
      </div>

      {searching ? (
        <section>
          <h2 className="font-pixel" style={{ fontSize: 9, margin: '0 0 10px' }}>
            {results.courses.length + results.tutorials.length > 0 ? 'RESULTS' : 'NO RESULTS'}
          </h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {results.courses.map((course) => (
              <CourseCard
                key={course.code}
                course={course}
                lang={lang}
                langMeta={langMeta}
                progress={progress}
                onOpen={() => onNavigate({ kind: 'course', code: course.code })}
              />
            ))}
            {results.tutorials.map((tutorial) => (
              <TutorialCard
                key={`${tutorial.category}/${tutorial.slug}`}
                tutorial={tutorial}
                lang={lang}
                langMeta={langMeta}
                onOpen={() => onNavigate({ kind: 'tutorial', category: tutorial.category, slug: tutorial.slug })}
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          {forYou.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2 className="font-pixel" style={{ fontSize: 9, margin: '0 0 10px' }}>FOR YOU</h2>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {forYou.map((entry) => (
                  <button
                    key={entry.course.code}
                    onClick={() => onNavigate({ kind: 'course', code: entry.course.code })}
                    className="text-left cursor-pointer transition-colors hover:bg-white/5"
                    style={{
                      border: '2px solid var(--alice-border)',
                      borderRadius: 2,
                      background: 'var(--alice-bg-soft)',
                      color: 'var(--alice-text)',
                      padding: '12px 14px',
                    }}
                  >
                    <div className="font-pixel" style={{ fontSize: 8, color: 'var(--alice-primary)' }}>
                      {entry.course.code.toUpperCase()}
                    </div>
                    <div className="font-numbers" style={{ fontSize: 15, marginTop: 8 }}>
                      {courseMeta(entry.course, lang, langMeta)?.name ?? entry.course.code}
                    </div>
                    <div className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)', marginTop: 6 }}>
                      {entry.reason[ui(lang)]}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
          {resume.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2 className="font-pixel" style={{ fontSize: 9, margin: '0 0 10px' }}>RESUME</h2>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {resume.map((entry) => {
                  const course = courseByCode.get(entry.courseCode);
                  if (!course) return null;
                  const total = courseChapterCount(course, lang, langMeta);
                  return (
                    <button
                      key={entry.courseCode}
                      onClick={() =>
                        entry.lastChapterId
                          ? onNavigate({ kind: 'chapter', code: entry.courseCode, chapterId: entry.lastChapterId })
                          : onNavigate({ kind: 'course', code: entry.courseCode })
                      }
                      className="text-left cursor-pointer transition-colors hover:bg-white/5"
                      style={{
                        border: '2px solid var(--alice-primary)',
                        borderRadius: 2,
                        background: 'var(--alice-bg-soft)',
                        color: 'var(--alice-text)',
                        padding: '12px 14px',
                      }}
                    >
                      <div className="font-pixel flex items-center justify-between" style={{ fontSize: 8, color: 'var(--alice-primary)' }}>
                        <span>{course.code.toUpperCase()}</span>
                        <span>{entry.read}/{total}</span>
                      </div>
                      <div className="font-numbers" style={{ fontSize: 15, marginTop: 8 }}>
                        {courseMeta(course, lang, langMeta)?.name ?? course.code}
                      </div>
                      <div style={{ display: 'flex', gap: 2, marginTop: 10 }} aria-hidden="true">
                        {Array.from({ length: Math.min(total, 24) }, (_, i) => (
                          <span
                            key={i}
                            style={{
                              flex: 1,
                              height: 6,
                              background:
                                i < Math.round((entry.read / Math.max(total, 1)) * Math.min(total, 24))
                                  ? 'var(--alice-primary)'
                                  : 'var(--alice-border)',
                            }}
                          />
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <h2 className="font-pixel" style={{ fontSize: 10, margin: '0 0 14px' }}>COURSES</h2>
            {sections.map((section) => (
              <div key={section.topic} style={{ marginBottom: 22 }}>
                <h3 className="font-pixel" style={{ fontSize: 8, color: 'var(--alice-muted)', margin: '0 0 8px' }}>
                  {(SECTION_LABELS[section.topic]?.[ui(lang)] ?? section.topic).toUpperCase()}
                </h3>
                <CarouselRow>
                  {section.courses.map((course) => (
                    <CourseCard
                      key={course.code}
                      course={course}
                      lang={lang}
                      langMeta={langMeta}
                      progress={progress}
                      fixedWidth
                      onOpen={() => onNavigate({ kind: 'course', code: course.code })}
                    />
                  ))}
                </CarouselRow>
              </div>
            ))}
          </section>

          <section style={{ marginTop: 34 }}>
            <h2 className="font-pixel" style={{ fontSize: 10, margin: '0 0 14px' }}>TUTORIALS</h2>
            {tutorialGroups.map((group) => (
              <div key={group.category} style={{ marginBottom: 22 }}>
                <h3 className="font-pixel flex items-baseline gap-2" style={{ fontSize: 8, color: 'var(--alice-muted)', margin: '0 0 8px' }}>
                  {(TUTORIAL_CATEGORY_LABELS[group.category]?.[ui(lang)] ?? group.category).toUpperCase()}
                  <span style={{ fontSize: 7, opacity: 0.7 }}>{group.tutorials.length}</span>
                </h3>
                <CarouselRow>
                  {group.tutorials.map((tutorial) => (
                    <TutorialCard
                      key={tutorial.slug}
                      tutorial={tutorial}
                      lang={lang}
                      langMeta={langMeta}
                      fixedWidth
                      onOpen={() => onNavigate({ kind: 'tutorial', category: group.category, slug: tutorial.slug })}
                    />
                  ))}
                </CarouselRow>
              </div>
            ))}
            <p className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)', marginTop: 16 }}>
              {lang === 'fr' ? 'Contenu ' : 'Content by '}
              <a
                href="https://planb.network" target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); void openExternalUrl('https://planb.network'); }}
                style={{ color: 'var(--alice-muted)', textDecoration: 'underline' }}
              >
                Plan ₿ Academy
              </a>
              {' · CC BY-SA 4.0'}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
