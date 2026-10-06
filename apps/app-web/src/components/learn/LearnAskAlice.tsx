'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@alice-wallet/alice-ai';
import type { LearnCoursePack } from '@alice-wallet/alice-content/src/learn-types';
import { ModelSelector } from '@/components/ModelSelector';
import { SideChatConversation } from '@/components/SideChatConversation';
import { SendMessageButton } from '@/components/SendMessageButton';
import { SvgIcon } from '@/components/SvgIcon';
import { PLUS_ICON, CLOSE_ICON, ATTACHMENT_ICON } from '@/lib/atelier-icons';
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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    element.style.height = '26px';
    element.style.height = Math.min(Math.max(element.scrollHeight, 26), 96) + 'px';
  }, [input]);
  const [attached, setAttached] = useState(true);
  const [payloadOpen, setPayloadOpen] = useState(false);
  // A quiz debrief or selection rescue overrides the page attachment with its
  // own richer context, and prefills the composer.
  const [override, setOverride] = useState<LearnAskRequest | null>(null);
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

  return (
    <div
      className="alice-ask-panel relative flex flex-col h-full w-full min-h-0"
      aria-label="Ask Alice about this course"
      style={{ backgroundColor: 'var(--alice-bg-soft)', borderLeft: '1px solid var(--alice-border)' }}
    >
      <div className="flex items-center justify-end px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => clearMessages()}
            className="alice-control alice-control--tool"
            aria-label="New conversation"
            title={lang === 'fr' ? 'Nouvelle discussion' : 'New conversation'}
          >
            <SvgIcon svg={PLUS_ICON} size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="alice-control alice-control--tool"
            aria-label="Close"
          >
            <SvgIcon svg={CLOSE_ICON} size={16} />
          </button>
        </div>
      </div>

      <SideChatConversation input={input} questions={questionChips} onQuestion={requestSend} lang={lang === 'fr' ? 'fr' : 'en'} />

      <div className="alice-panel-composer flex flex-col gap-2 shrink-0">
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
          aria-label="Message Alice"
          ref={composerRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              requestSend();
            }
          }}
          placeholder={lang === 'fr' ? 'Une question sur ce cours…' : 'Ask about this course…'}
          rows={1}
          className="font-numbers w-full resize-none bg-transparent outline-none"
          style={{ fontSize: 16, lineHeight: '26px', height: 26, minHeight: 26, maxHeight: 96, color: 'var(--alice-text)', border: 0, overflowY: 'auto' }}
        />

        <div className="flex items-center justify-between gap-2">
          {attached && context ? (
            <div
              className="alice-attachment"
            >
              <button
                type="button"
                onClick={() => setPayloadOpen((v) => !v)}
                aria-expanded={payloadOpen}
                title="Show the exact text sent to the model"
                className="alice-control alice-control--quiet alice-attachment-label"
              >
                <SvgIcon svg={ATTACHMENT_ICON} size={16} />
                <span className="font-numbers block truncate" style={{ fontSize: 12, color: 'var(--alice-text)' }}>
                  {context.label}
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setAttached(false); setOverride(null); }}
                aria-label="Remove this attachment"
                className="alice-control alice-control--tool"
              >
                <SvgIcon svg={CLOSE_ICON} size={16} />
              </button>
            </div>
          ) : (
            <span />
          )}
        </div>
        <div className="alice-panel-controls">
          <ModelSelector
            backendType={backendType}
            setBackendType={setBackendType}
            setAiEnabled={setAiEnabled}
            placement="composer"
          />
          <SendMessageButton onClick={() => requestSend()} disabled={busy || !input.trim() || !aiEnabled} label={lang === 'fr' ? 'Envoyer le message' : 'Send message'} />
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
