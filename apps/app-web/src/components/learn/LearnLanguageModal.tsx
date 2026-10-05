'use client';

import { SvgIcon } from '@/components/SvgIcon';
import { CLOSE_ICON, DOWNLOAD_ICON, CHECK_ICON, BACK_ICON } from '@/lib/atelier-icons';

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
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={fr ? 'Langue des cours' : 'Course language'}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
        className="flex flex-col"
        style={{
          width: 'min(100%, 420px)',
          maxHeight: '80dvh',
          background: 'var(--alice-bg)',
          border: '1px solid var(--alice-border)',
          borderRadius: 'var(--alice-radius-control)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between shrink-0" style={{ padding: '14px 16px', borderBottom: '1px solid var(--alice-border)' }}>
          <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-primary)' }}>
            {fr ? 'LANGUE DES COURS' : 'COURSE LANGUAGE'}
          </span>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label={fr ? 'Fermer' : 'Close'}
            className="alice-control alice-control--tool"
            style={{ lineHeight: '18px' }}
          >
            <SvgIcon svg={CLOSE_ICON} size={16} />
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
                  aria-pressed={isCurrent}
                  className="alice-control alice-control--row alice-choice flex items-center gap-3 w-full text-left"
                  style={{ display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr) 20px', columnGap: 10, rowGap: 4, padding: '10px 16px' }}
                >
                  <span className="font-numbers shrink-0" style={{ fontSize: 12, width: 42, color: isCurrent ? 'var(--alice-primary)' : 'var(--alice-muted)' }}>
                    {entry.lang.toUpperCase()}
                  </span>
                  <span className="font-numbers flex-1 min-w-0 truncate" style={{ fontSize: 15 }}>
                    {languageName(entry.lang)}
                  </span>
                  <span className="font-numbers shrink-0" style={{ fontSize: 12, color: 'var(--alice-muted)', gridColumn: '2', gridRow: '2' }}>
                    {entry.courses} {fr ? 'cours' : 'courses'}
                  </span>
                  <span
                    className="font-numbers shrink-0"
                    style={{ fontSize: 12, gridColumn: '1 / -1', gridRow: '3', textAlign: 'left', color: isInstalled ? 'var(--alice-primary)' : 'var(--alice-muted)' }}
                  >
                    {isCurrent ? (fr ? 'Active' : 'Active') : isEmbeddedLang(entry.lang) ? (fr ? 'Incluse · utiliser' : 'Included · use') : isInstalled ? (fr ? 'Disponible · utiliser' : 'Available · use') : !isTauriDesktop() ? (fr ? 'Lire en ligne' : 'Read online') : (fr ? 'Télécharger' : 'Download')}
                  </span>
                  <span style={{ gridColumn: 3, gridRow: 1 }}><SvgIcon svg={isCurrent || isInstalled ? CHECK_ICON : DOWNLOAD_ICON} size={20} /></span>
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
                className="alice-control alice-control--primary"
                style={{ padding: '10px 16px' }}
                onClick={() => startDownload(phase.lang)}
              >
                <SvgIcon svg={DOWNLOAD_ICON} size={20} /> {fr ? 'Télécharger et utiliser' : 'Download and use'}
              </button>
              <button
                type="button"
                className="alice-control alice-control--quiet"
                style={{ padding: '10px 16px' }}
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
            <div role="progressbar" aria-label={fr ? 'Téléchargement de la langue' : 'Language download'} aria-valuenow={Math.round(phase.progress * 100)} aria-valuemin={0} aria-valuemax={100} style={{ marginTop: 12, height: 8, border: '1px solid var(--alice-border)', borderRadius: 'var(--alice-radius-control)' }}>
              <div style={{ height: '100%', width: `${Math.round(phase.progress * 100)}%`, background: 'var(--alice-primary)' }} />
            </div>
            <p className="font-numbers" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--alice-muted)' }}>
              {Math.round(phase.progress * 100)}%
            </p>
          </div>
        )}

        {phase.step === 'error' && (
          <div role="alert" style={{ padding: '18px 16px' }}>
            <p className="font-numbers" style={{ margin: 0, fontSize: 14, color: 'var(--alice-text)' }}>
              {fr
                ? `Le téléchargement du ${languageName(phase.lang)} a échoué : ${phase.message}`
                : `Downloading ${languageName(phase.lang)} failed: ${phase.message}`}
            </p>
            <button
              type="button"
              className="alice-control alice-control--quiet"
              style={{ marginTop: 14, padding: '10px 16px' }}
              onClick={() => setPhase({ step: 'browse' })}
            >
              <SvgIcon svg={BACK_ICON} size={16} /> {fr ? 'Retour' : 'Back'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
