'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@alice-wallet/alice-ai';
import type { LearnCoursePack } from '@alice-wallet/alice-content/src/learn-types';
import { AliceIcon } from '@/components/AliceIcon';
import { AskAliceIcon } from '@/components/AskAliceIcon';
import { ChatMessage } from '@/components/ChatMessage';
import { ModelSelector } from '@/components/ModelSelector';
import { LEARN_ASK_EVENT, consumeLearnAsk, type LearnAskRequest } from '@/lib/learn/ask';
import { findCourse, findTutorial } from '@/lib/learn/catalog';
import type { LearnLang } from '@/lib/learn/language';
import { fetchCoursePack } from '@/lib/learn/packs';
import type { LearnView } from '@/lib/learn/route';

// The Learn twin of the Explorer's Ask-Alice sidebar: same shell, same shared
// chat, but the attachment is the page being READ (course/chapter/tutorial),
// public catalog metadata only. The chip shows exactly what rides along with
// the question, and is removable.

interface LearnContext {
  /** Short human label on the chip. */
  label: string;
  /** The exact prefix sent with the question. */
  text: string;
}

function useLearnContext(view: LearnView, lang: LearnLang): LearnContext | null {
  const [pack, setPack] = useState<LearnCoursePack | null>(null);

  const code = view.kind === 'course' || view.kind === 'chapter' || view.kind === 'quiz' ? view.code : null;
  useEffect(() => {
    let cancelled = false;
    setPack(null);
    if (!code) return;
    fetchCoursePack(lang, code)
      .then((p) => { if (!cancelled) setPack(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [code, lang]);

  return useMemo(() => {
    if (view.kind === 'tutorial') {
      const tutorial = findTutorial(view.category, view.slug);
      const name = tutorial?.i18n[lang]?.name ?? view.slug;
      return {
        label: name,
        text:
          lang === 'fr'
            ? `Contexte : je lis le tutoriel « ${name} » (Plan B Academy). `
            : `Context: I am reading the tutorial "${name}" (Plan B Academy). `,
      };
    }
    if (!code) return null;
    const courseName = findCourse(code)?.i18n[lang]?.name ?? pack?.name ?? code;
    if (view.kind === 'chapter') {
      const chapter = pack?.parts.flatMap((p) => p.chapters).find((c) => c.chapterId === view.chapterId);
      const title = chapter?.title;
      return {
        label: title ? `${code.toUpperCase()} · ${title}` : code.toUpperCase(),
        text:
          lang === 'fr'
            ? `Contexte : je lis le cours ${code.toUpperCase()} « ${courseName} »${title ? `, chapitre « ${title} »` : ''} (Plan B Academy). `
            : `Context: I am reading course ${code.toUpperCase()} "${courseName}"${title ? `, chapter "${title}"` : ''} (Plan B Academy). `,
      };
    }
    return {
      label: `${code.toUpperCase()} · ${courseName}`,
      text:
        lang === 'fr'
          ? `Contexte : je consulte le cours ${code.toUpperCase()} « ${courseName} » (Plan B Academy). `
          : `Context: I am looking at course ${code.toUpperCase()} "${courseName}" (Plan B Academy). `,
    };
  }, [view, lang, code, pack]);
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <AliceIcon size={22} color="var(--alice-primary)" />
      {[0, 0.2, 0.4].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ backgroundColor: 'var(--alice-muted)', animationDelay: `${delay}s`, animationDuration: '1.4s' }}
        />
      ))}
    </div>
  );
}

export function LearnAskAlice({
  view,
  lang,
  onClose,
}: {
  view: LearnView;
  lang: LearnLang;
  onClose: () => void;
}) {
  const { messages, send, busy, aiEnabled, backendType, setBackendType, setAiEnabled, clearMessages } = useChat();
  const pageContext = useLearnContext(view, lang);
  const [input, setInput] = useState('');
  const [attached, setAttached] = useState(true);
  const [payloadOpen, setPayloadOpen] = useState(false);
  // A quiz debrief or selection rescue overrides the page attachment with its
  // own richer context, and prefills the composer.
  const [override, setOverride] = useState<LearnAskRequest | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const context = override ?? pageContext;

  // A new attachment starts a new discussion: the previous thread is archived
  // in history, and the incoming quiz/selection/page context opens on a clean
  // slate. Refs so the mount-effect listeners see fresh values.
  const startFreshRef = useRef<() => void>(() => {});
  startFreshRef.current = () => {
    if (messages.some((m) => m.role === 'user')) clearMessages();
  };

  useEffect(() => {
    const adopt = () => {
      const request = consumeLearnAsk();
      if (!request) return;
      startFreshRef.current();
      setOverride(request);
      setInput(request.draft);
      setAttached(true);
      setPayloadOpen(false);
    };
    adopt();
    window.addEventListener(LEARN_ASK_EVENT, adopt);
    return () => window.removeEventListener(LEARN_ASK_EVENT, adopt);
  }, []);

  // The proposed attachment follows the page being read; navigating away
  // drops a stale quiz/selection override. Guarded by comparing the previous
  // key (not a first-run flag): the panel may have just been opened BY such
  // an override, and dev StrictMode re-runs effects on the same key.
  const contextKey = pageContext?.label ?? '';
  const prevContextKey = useRef(contextKey);
  useEffect(() => {
    if (prevContextKey.current === contextKey) return;
    prevContextKey.current = contextKey;
    setOverride(null);
    setAttached(true);
    setPayloadOpen(false);
  }, [contextKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, busy]);

  const questionChips =
    lang === 'fr'
      ? ['Explique-moi ce chapitre autrement', 'Donne-moi un exemple concret', 'Pourquoi est-ce important ?']
      : ['Explain this chapter differently', 'Give me a concrete example', 'Why does this matter?'];

  function requestSend(raw?: string) {
    const q = (raw ?? input).trim();
    if (!q || busy || !aiEnabled) return;
    setInput('');
    void send(attached && context ? `${context.text}${q}` : q);
  }

  const latestUserIndex = messages.reduce((latest, m, i) => (m.role === 'user' ? i : latest), -1);
  const replyStarted =
    latestUserIndex >= 0 &&
    messages.slice(latestUserIndex + 1).some((m) => m.role === 'assistant' && m.content.trim().length > 0);

  return (
    <div
      className="relative flex flex-col h-full w-full min-h-0"
      aria-label="Ask Alice about this course"
      style={{ backgroundColor: 'var(--alice-bg-soft)', borderLeft: '1px solid var(--alice-border)' }}
    >
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <ModelSelector
          backendType={backendType}
          setBackendType={setBackendType}
          setAiEnabled={setAiEnabled}
          compactLabel
          placement="below"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => clearMessages()}
            className="cursor-pointer bg-transparent border-none"
            style={{ color: 'var(--alice-muted)', fontSize: 18, lineHeight: '18px' }}
            aria-label="New conversation"
            title={lang === 'fr' ? 'Nouvelle discussion' : 'New conversation'}
          >
            +
          </button>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer bg-transparent border-none"
            style={{ color: 'var(--alice-muted)', fontSize: 18, lineHeight: '18px' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={
          messages.length === 0
            ? 'flex flex-col items-center justify-center gap-4 px-6 flex-1 overflow-y-auto'
            : 'flex flex-col gap-1 px-4 py-3 flex-1 overflow-y-auto overflow-x-hidden'
        }
        style={{ overflowWrap: 'anywhere' }}
      >
        {messages.length === 0 ? (
          <>
            <AskAliceIcon size={44} />
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-primary)' }}>
              ASK ALICE
            </span>
            <div className="flex flex-col items-stretch gap-2 w-full" style={{ maxWidth: 300 }}>
              {questionChips.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => requestSend(q)}
                  disabled={busy}
                  className="font-numbers cursor-pointer disabled:cursor-not-allowed"
                  style={{ fontSize: 13, padding: '8px 12px', border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'transparent', color: 'var(--alice-primary)' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {(() => {
              const streamingId =
                busy && replyStarted
                  ? [...messages].reverse().find((m) => m.role === 'assistant' && m.content)?.id
                  : undefined;
              return messages.map((m) => (
                <ChatMessage key={m.id} message={m} compact streaming={m.id === streamingId} />
              ));
            })()}
            {busy && !replyStarted && <TypingIndicator />}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--alice-border)' }}>
        {payloadOpen && attached && context && (
          <div className="flex flex-col gap-2 px-3 py-2" style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
              SENT TO ALICE, EXACTLY:
            </span>
            <p className="font-numbers m-0" style={{ fontSize: 11, lineHeight: '16px', color: 'var(--alice-text)' }}>
              {context.text}
            </p>
            <p className="font-numbers m-0" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
              Public course metadata only; nothing about your wallet rides along.
            </p>
          </div>
        )}

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              requestSend();
            }
          }}
          placeholder={lang === 'fr' ? 'Une question sur ce cours…' : 'Ask about this course…'}
          rows={2}
          className="font-numbers w-full resize-none bg-transparent outline-none"
          style={{ fontSize: 14, color: 'var(--alice-text)', border: 0 }}
        />

        <div className="flex items-center justify-between gap-2">
          {attached && context ? (
            <div
              className="flex items-center gap-2 min-w-0"
              style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg)', padding: '5px 8px' }}
            >
              <button
                type="button"
                onClick={() => setPayloadOpen((v) => !v)}
                aria-expanded={payloadOpen}
                title="Show the exact text sent to the model"
                className="flex items-center gap-1.5 cursor-pointer bg-transparent border-none p-0 min-w-0"
              >
                <span className="font-pixel shrink-0" style={{ fontSize: 8, color: 'var(--alice-primary)' }}>LEARN</span>
                <span className="font-numbers block truncate" style={{ fontSize: 12, color: 'var(--alice-text)', maxWidth: 200 }}>
                  {context.label}
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setAttached(false); setOverride(null); }}
                aria-label="Remove this attachment"
                className="shrink-0 cursor-pointer bg-transparent border-none p-0"
                style={{ color: 'var(--alice-muted)', fontSize: 13, lineHeight: '13px' }}
              >
                ×
              </button>
            </div>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => requestSend()}
            disabled={busy || !input.trim() || !aiEnabled}
            className="font-pixel cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
            style={{ fontSize: 8, padding: '10px 14px', background: 'var(--alice-primary)', color: 'var(--alice-on-primary)', border: 0, borderRadius: 2 }}
          >
            {lang === 'fr' ? 'ENVOYER' : 'SEND'}
          </button>
        </div>
        {!aiEnabled && (
          <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>
            Alice is turned off. Turn it on in Settings to ask.
          </p>
        )}
      </div>
    </div>
  );
}
