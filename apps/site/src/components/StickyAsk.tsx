'use client';

import { useEffect, useState } from 'react';
import { APP_URL, appQuestionUrl } from '@/lib/site';
import { AliceMark } from '@/components/icons';

// Persistent "ask Alice" bar, docked to the bottom of the viewport on every page.
// Submitting hands off to the app with the question attached (and autosend), so
// the marketing site never runs an AI backend of its own. The placeholder cycles
// example questions and the button breathes a soft glow to invite a try; both
// respect prefers-reduced-motion (the glow via CSS, the cycling by pausing).
const EXAMPLES = [
  'What is self-custody?',
  'Is my AI chat private?',
  'How do I secure my Bitcoin?',
  'What is the Ark protocol?',
];

export function StickyAsk() {
  const [value, setValue] = useState('');
  const [phIdx, setPhIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = setInterval(() => setPhIdx((i) => (i + 1) % EXAMPLES.length), 3200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-[var(--alice-border)] bg-[var(--alice-bg-soft)]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = value.trim();
          setSubmitting(true);
          window.location.href = q ? appQuestionUrl(q) : APP_URL;
        }}
        className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]"
      >
        <span className="hidden shrink-0 items-center gap-2 pr-1 sm:flex">
          <AliceMark size={26} showWordmark={false} />
          <span className="text-[15px] font-semibold text-[var(--alice-heading)]">Ask Alice</span>
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={submitting}
          placeholder={EXAMPLES[phIdx]}
          aria-label="Ask Alice a question"
          className="min-w-0 flex-1 rounded-[3px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg)] px-4 py-2.5 text-base text-[var(--alice-heading)] placeholder:text-[var(--alice-muted)] focus:border-[var(--alice-primary)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={submitting}
          aria-label={submitting ? 'Opening Alice' : 'Ask Alice'}
          aria-live="polite"
          className="ask-glow flex min-w-[88px] shrink-0 items-center justify-center rounded-[3px] border-2 border-[var(--alice-primary)] bg-[var(--alice-primary)] px-5 py-2.5 text-[15px] font-semibold text-[var(--alice-on-primary)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:hover:translate-y-0"
        >
          {submitting ? (
            <span className="flex h-[22px] items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-current"
                  style={{ animationDelay: `${dot * 120}ms` }}
                />
              ))}
            </span>
          ) : (
            'Ask →'
          )}
        </button>
      </form>
    </div>
  );
}
