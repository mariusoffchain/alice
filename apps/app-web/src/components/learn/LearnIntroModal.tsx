'use client';

import { useState } from 'react';

// First-open welcome for the Learn section, the twin of ExplorerIntroModal:
// shown on every mount until the user ticks "don't show this again". It says
// what the interface alone does not: this is a full course library, and the
// content is Plan ₿ Academy's under CC BY-SA 4.0 (the attribution belongs in
// front of the reader, not only in a footer). Languages get a button rather
// than a sentence.

const KEY = 'learn.intro-dismissed.v1';

export function wasLearnIntroDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    // Storage unavailable: never nag a user we cannot remember.
    return true;
  }
}

export function LearnIntroModal({
  lang,
  onClose,
  onPickLanguage,
}: {
  lang: string;
  onClose: () => void;
  /** Opens the language picker straight from the dialog. */
  onPickLanguage: () => void;
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const fr = lang === 'fr';

  function confirm() {
    if (dontShowAgain) {
      try {
        window.localStorage.setItem(KEY, '1');
      } catch {
        // Best effort: worst case the intro shows again.
      }
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          padding: 18,
          backgroundColor: 'var(--alice-bg)',
          border: '2px solid var(--alice-border)',
          borderRadius: 2,
          color: 'var(--alice-text)',
        }}
      >
        <h3
          className="font-pixel tracking-widest m-0"
          style={{ fontSize: 13, color: 'var(--alice-primary-dark)' }}
        >
          {fr ? 'BIENVENUE DANS LEARN' : 'WELCOME TO LEARN'}
        </h3>
        <p className="font-numbers m-0 mt-3" style={{ fontSize: 15, lineHeight: '21px', opacity: 0.85 }}>
          {fr
            ? 'Une bibliothèque de cours et de tutoriels sur Bitcoin, du premier pas à la vie privée, au minage et au réseau Lightning. Chaque cours se lit chapitre par chapitre, avec des quiz et des liens vers la chaîne réelle dans l’Explorer.'
            : 'A library of Bitcoin courses and tutorials, from the first steps to privacy, mining and the Lightning Network. Every course reads chapter by chapter, with quizzes and links into the real chain in the Explorer.'}
        </p>
        <p className="font-numbers m-0 mt-2" style={{ fontSize: 15, lineHeight: '21px', opacity: 0.85 }}>
          {fr
            ? 'Le contenu est celui de Plan ₿ Academy, sous licence CC BY-SA 4.0. Alice ne le réécrit pas : elle l’explique quand tu bloques.'
            : 'The content is Plan ₿ Academy’s, licensed CC BY-SA 4.0. Alice never rewrites it: she explains it when you get stuck.'}
        </p>

        <div className="flex items-center justify-between gap-3 mt-5">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--alice-primary)' }}
            />
            <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
              {fr ? 'Ne plus afficher' : 'Don’t show this again'}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { confirm(); onPickLanguage(); }}
              className="font-pixel tracking-widest cursor-pointer"
              style={{
                fontSize: 10,
                padding: '10px 14px',
                border: '2px solid var(--alice-border)',
                borderRadius: 2,
                backgroundColor: 'transparent',
                color: 'var(--alice-muted)',
              }}
            >
              {fr ? 'CHOISIR LA LANGUE' : 'PICK A LANGUAGE'}
            </button>
            <button
              type="button"
              onClick={confirm}
              className="font-pixel tracking-widest cursor-pointer"
              style={{
                fontSize: 10,
                padding: '10px 22px',
                border: '2px solid var(--alice-primary)',
                borderRadius: 2,
                backgroundColor: 'var(--alice-primary)',
                color: 'var(--alice-on-primary)',
              }}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
