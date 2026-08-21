'use client';

import { useState } from 'react';
import { LEARN_LANGUAGES } from '@alice-wallet/alice-content/src/generated/planb-learn-catalog';
import {
  installedLanguages,
  isEmbeddedLang,
  languageName,
  type LearnLang,
} from '@/lib/learn/language';
import { downloadLanguage } from '@/lib/learn/language-downloads';
import { isTauriDesktop } from '@alice-wallet/alice-ai';

// The PlanB-style language picker: every corpus language, its native name and
// course coverage. Installed languages switch immediately.
//
// What happens to the others depends on where Alice runs. On the web, a
// language is just content behind a URL: picking one switches to it at once
// and the packs warm the browser cache in the background, because asking
// permission to "download" a website's own pages is ceremony that protects
// nothing. On the desktop, the download step stays: there it is a real
// promise, the language keeps working offline, and a promise deserves a
// progress bar and a yes.

type Phase =
  | { step: 'browse' }
  | { step: 'confirm'; lang: string }
  | { step: 'downloading'; lang: string; progress: number }
  | { step: 'error'; lang: string; message: string };

export function LearnLanguageModal({
  currentLang,
  onSelect,
  onClose,
}: {
  currentLang: LearnLang;
  onSelect: (lang: LearnLang) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ step: 'browse' });
  const installed = installedLanguages();
  const fr = currentLang === 'fr';

  const pick = (lang: string) => {
    if (installed.includes(lang)) {
      onSelect(lang);
      onClose();
      return;
    }
    if (!isTauriDesktop()) {
      // Fire-and-forget: the cache warms while the person is already reading.
      void downloadLanguage(lang).catch(() => {});
      onSelect(lang);
      onClose();
      return;
    }
    setPhase({ step: 'confirm', lang });
  };

  const startDownload = (lang: string) => {
    setPhase({ step: 'downloading', lang, progress: 0 });
    downloadLanguage(lang, (progress) => {
      setPhase((current) =>
        current.step === 'downloading' && current.lang === lang
          ? { step: 'downloading', lang, progress }
          : current,
      );
    })
      .then(() => {
        onSelect(lang);
        onClose();
      })
      .catch((error: unknown) => {
        setPhase({
          step: 'error',
          lang,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.55)' }}
      onClick={onClose}
      role="dialog"
      aria-label="Course languages"
    >
      <div
        className="flex flex-col"
        style={{
          width: 'min(100%, 420px)',
          maxHeight: '80dvh',
          background: 'var(--alice-bg)',
          border: '2px solid var(--alice-border)',
          borderRadius: 2,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0" style={{ padding: '14px 16px', borderBottom: '1px solid var(--alice-border)' }}>
          <span className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-primary)' }}>
            {fr ? 'LANGUE DES COURS' : 'COURSE LANGUAGE'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer bg-transparent border-none"
            style={{ color: 'var(--alice-muted)', fontSize: 18, lineHeight: '18px' }}
          >
            ×
          </button>
        </div>

        {phase.step === 'browse' && (
          <div className="flex-1 overflow-y-auto" style={{ padding: '8px 0' }}>
            {LEARN_LANGUAGES.map((entry) => {
              const isInstalled = installed.includes(entry.lang);
              const isCurrent = entry.lang === currentLang;
              return (
                <button
                  key={entry.lang}
                  type="button"
                  onClick={() => pick(entry.lang)}
                  className="flex items-center gap-3 w-full text-left cursor-pointer transition-colors hover:bg-white/5"
                  style={{ background: 'transparent', border: 0, padding: '10px 16px', color: 'var(--alice-text)' }}
                >
                  <span className="font-pixel shrink-0" style={{ fontSize: 8, width: 64, color: isCurrent ? 'var(--alice-primary)' : 'var(--alice-muted)' }}>
                    {entry.lang.toUpperCase()}
                  </span>
                  <span className="font-numbers flex-1 min-w-0 truncate" style={{ fontSize: 15 }}>
                    {languageName(entry.lang)}
                  </span>
                  <span className="font-numbers shrink-0" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>
                    {entry.courses} {fr ? 'cours' : 'courses'}
                  </span>
                  <span
                    className="font-pixel shrink-0"
                    style={{ fontSize: 7, width: 86, textAlign: 'right', color: isInstalled ? 'var(--alice-primary)' : 'var(--alice-muted)' }}
                  >
                    {isCurrent ? (fr ? 'ACTUELLE' : 'CURRENT') : isInstalled ? (fr ? 'INSTALLÉE' : 'INSTALLED') : (fr ? 'TÉLÉCHARGER' : 'DOWNLOAD')}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {phase.step === 'confirm' && (
          <div style={{ padding: '18px 16px' }}>
            <p className="font-numbers" style={{ margin: 0, fontSize: 15, lineHeight: '24px', color: 'var(--alice-text)' }}>
              {fr
                ? `Voulez-vous télécharger les cours Bitcoin en ${languageName(phase.lang)} ?`
                : `Download the Bitcoin courses in ${languageName(phase.lang)}?`}
            </p>
            <p className="font-numbers" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--alice-muted)' }}>
              {fr
                ? 'La langue rejoindra ensuite votre sélecteur rapide.'
                : 'The language will then join your quick selector.'}
            </p>
            <div className="flex gap-3" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="font-pixel cursor-pointer"
                style={{ fontSize: 8, padding: '10px 16px', background: 'var(--alice-primary)', color: 'var(--alice-on-primary)', border: 0, borderRadius: 2 }}
                onClick={() => startDownload(phase.lang)}
              >
                {fr ? 'OUI, TÉLÉCHARGER' : 'YES, DOWNLOAD'}
              </button>
              <button
                type="button"
                className="font-pixel cursor-pointer"
                style={{ fontSize: 8, padding: '10px 16px', background: 'transparent', color: 'var(--alice-text)', border: '2px solid var(--alice-border)', borderRadius: 2 }}
                onClick={() => setPhase({ step: 'browse' })}
              >
                {fr ? 'ANNULER' : 'CANCEL'}
              </button>
            </div>
          </div>
        )}

        {phase.step === 'downloading' && (
          <div style={{ padding: '18px 16px' }}>
            <p className="font-numbers" style={{ margin: 0, fontSize: 14, color: 'var(--alice-text)' }}>
              {fr ? `Téléchargement du ${languageName(phase.lang)}…` : `Downloading ${languageName(phase.lang)}…`}
            </p>
            <div style={{ marginTop: 12, height: 8, border: '1px solid var(--alice-border)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${Math.round(phase.progress * 100)}%`, background: 'var(--alice-primary)' }} />
            </div>
            <p className="font-pixel" style={{ margin: '8px 0 0', fontSize: 8, color: 'var(--alice-muted)' }}>
              {Math.round(phase.progress * 100)}%
            </p>
          </div>
        )}

        {phase.step === 'error' && (
          <div style={{ padding: '18px 16px' }}>
            <p className="font-numbers" style={{ margin: 0, fontSize: 14, color: 'var(--alice-text)' }}>
              {fr
                ? `Le téléchargement du ${languageName(phase.lang)} a échoué : ${phase.message}`
                : `Downloading ${languageName(phase.lang)} failed: ${phase.message}`}
            </p>
            <button
              type="button"
              className="font-pixel cursor-pointer"
              style={{ marginTop: 14, fontSize: 8, padding: '10px 16px', background: 'transparent', color: 'var(--alice-text)', border: '2px solid var(--alice-border)', borderRadius: 2 }}
              onClick={() => setPhase({ step: 'browse' })}
            >
              {fr ? 'RETOUR' : 'BACK'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
