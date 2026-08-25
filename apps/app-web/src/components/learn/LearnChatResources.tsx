'use client';

import { useRouter } from 'next/navigation';
import type { ChatMsg } from '@alice-wallet/alice-ai';
import type { LearnExplorerAnchor } from '@alice-wallet/alice-content/src/learn-anchors';
import { openAnchorFromChat } from '@/lib/learn/explorer-link';
import { loadProgress, readCount } from '@/lib/learn/progress';
import { requestPlaygroundView } from '@/lib/playground-open';
import type { LearnChatResources as Resources } from '@/lib/learn/suggest-catalog';

// The "Pour aller plus loin" block, visually attached to the end of Alice's
// reply: a hairline, a small label, then one compact row per resource (course
// or tutorial from the deterministic scorer, verified Explorer anchors from
// the hand-curated table). The resources are computed by the SEND HANDLER;
// this component only decides WHEN to show them: after the reply that answers
// the suggesting message is done.
export function LearnChatResources({
  resources,
  question,
  messages,
  busy,
  lang,
}: {
  resources: Resources | null;
  /** The user message these resources answer; the block only shows while it
      is still the conversation's latest question (survives remounts). */
  question: string;
  messages: ChatMsg[];
  busy: boolean;
  lang: 'fr' | 'en';
}) {
  const router = useRouter();
  if (!resources || busy) return null;
  const { learn, chapter, anchors, playground } = resources;
  if (!learn && !chapter && anchors.length === 0 && !playground) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || !last.content.trim()) return null;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser || lastUser.content.trim() !== question) return null;

  const started = learn?.kind === 'course' && readCount(loadProgress(), learn.code) > 0;

  return (
    <div
      className="flex flex-col"
      style={{
        margin: '2px 0 8px',
        paddingTop: 10,
        borderTop: '1px solid var(--alice-border)',
        maxWidth: 480,
      }}
    >
      <span className="font-pixel" style={{ fontSize: 7, letterSpacing: 1, color: 'var(--alice-muted)' }}>
        {lang === 'fr' ? 'POUR ALLER PLUS LOIN' : 'TO GO FURTHER'}
      </span>

      {learn && (
        <button
          onClick={() =>
            router.push(learn.kind === 'course' ? `/learn/?course=${learn.code}` : `/learn/?tutorial=${learn.code}`)
          }
          className="flex items-center gap-3 text-left cursor-pointer transition-colors hover:bg-white/5"
          style={{ background: 'transparent', border: 0, padding: '8px 2px', color: 'var(--alice-text)' }}
        >
          <span className="font-pixel shrink-0" style={{ fontSize: 7, color: 'var(--alice-primary)' }}>
            LEARN
          </span>
          <span className="font-numbers min-w-0 truncate" style={{ fontSize: 14 }}>{learn.title}</span>
          <span className="font-pixel shrink-0" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
            {learn.kind === 'course'
              ? started
                ? (lang === 'fr' ? `${learn.code.toUpperCase()} · REPRENDRE` : `${learn.code.toUpperCase()} · RESUME`)
                : learn.code.toUpperCase()
              : (lang === 'fr' ? 'TUTORIEL' : 'TUTORIAL')}
          </span>
          <span className="font-pixel shrink-0 ml-auto" style={{ fontSize: 9, color: 'var(--alice-primary)' }}>→</span>
        </button>
      )}

      {chapter && (
        <button
          onClick={() => router.push(`/learn/?course=${chapter.courseCode}&chapter=${chapter.chapterId}`)}
          className="flex items-center gap-3 text-left cursor-pointer transition-colors hover:bg-white/5"
          style={{ background: 'transparent', border: 0, padding: '8px 2px', color: 'var(--alice-text)' }}
        >
          <span className="font-pixel shrink-0" style={{ fontSize: 7, color: 'var(--alice-primary)' }}>
            LEARN
          </span>
          <span className="font-numbers min-w-0 truncate" style={{ fontSize: 14 }}>{chapter.title}</span>
          <span className="font-pixel shrink-0" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
            {chapter.courseCode.toUpperCase()}
          </span>
          <span className="font-pixel shrink-0 ml-auto" style={{ fontSize: 9, color: 'var(--alice-primary)' }}>→</span>
        </button>
      )}

      {playground && (
        <button
          onClick={() => {
            requestPlaygroundView(playground);
            router.push('/playground');
          }}
          className="flex items-center gap-3 text-left cursor-pointer transition-colors hover:bg-white/5"
          style={{ background: 'transparent', border: 0, padding: '8px 2px', color: 'var(--alice-text)' }}
        >
          <span className="font-pixel shrink-0" style={{ fontSize: 7, color: 'var(--alice-primary)' }}>
            PLAYGROUND
          </span>
          <span className="font-numbers min-w-0 truncate" style={{ fontSize: 14 }}>
            {lang === 'fr' ? 'Essayez-le avec des sats d’entraînement' : 'Try it with training sats'}
          </span>
          <span className="font-pixel shrink-0 ml-auto" style={{ fontSize: 9, color: 'var(--alice-primary)' }}>→</span>
        </button>
      )}

      {anchors.map((anchor: LearnExplorerAnchor) => (
        <button
          key={`${anchor.type}:${anchor.id}`}
          onClick={() => openAnchorFromChat(anchor, lang, (path) => router.push(path))}
          className="flex items-center gap-3 text-left cursor-pointer transition-colors hover:bg-white/5"
          style={{ background: 'transparent', border: 0, padding: '8px 2px', color: 'var(--alice-text)' }}
        >
          <span className="font-pixel shrink-0" style={{ fontSize: 7, color: 'var(--alice-primary)' }}>
            EXPLORER
          </span>
          <span className="font-numbers min-w-0 truncate" style={{ fontSize: 14 }}>{anchor.label[lang]}</span>
          <span className="font-pixel shrink-0" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>
            {anchor.type === 'block' ? `${lang === 'fr' ? 'BLOC' : 'BLOCK'} ${anchor.id}` : anchor.type.toUpperCase()}
          </span>
          <span className="font-pixel shrink-0 ml-auto" style={{ fontSize: 9, color: 'var(--alice-primary)' }}>→</span>
        </button>
      ))}
    </div>
  );
}
