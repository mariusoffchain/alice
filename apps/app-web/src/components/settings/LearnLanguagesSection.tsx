'use client';

import { useEffect, useState } from 'react';
import { LearnLanguageModal } from '@/components/learn/LearnLanguageModal';
import {
  installedLanguages,
  isEmbeddedLang,
  languageName,
  removeInstalledLanguage,
  type LearnLang,
} from '@/lib/learn/language';
import { btnBase, SectionLabel, sectionStyle } from './ui';

// Course-language management mirrored in Settings: the same picker as the
// Learn page's globe button, plus removal of downloaded languages (the
// embedded pair stays).
export function LearnLanguagesSection() {
  const [installed, setInstalled] = useState<LearnLang[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refresh = () => setInstalled(installedLanguages());
  useEffect(refresh, []);

  return (
    <div style={sectionStyle}>
      <SectionLabel>COURSE LANGUAGES</SectionLabel>
      <p className="font-numbers" style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--alice-muted)' }}>
        Languages available in the Learn quick selector. Plan ₿ Academy content exists in {`${28}`} languages.
      </p>
      <div className="flex flex-col" style={{ marginTop: 12, border: '1px solid var(--alice-border)', borderRadius: 2 }}>
        {installed.map((lang, index) => (
          <div
            key={lang}
            className="flex items-center gap-3"
            style={{ padding: '10px 12px', borderTop: index > 0 ? '1px solid var(--alice-border)' : undefined }}
          >
            <span className="font-pixel" style={{ fontSize: 8, width: 64, color: 'var(--alice-primary)' }}>
              {lang.toUpperCase()}
            </span>
            <span className="font-numbers flex-1" style={{ fontSize: 14, color: 'var(--alice-text)' }}>
              {languageName(lang)}
            </span>
            {isEmbeddedLang(lang) ? (
              <span className="font-pixel" style={{ fontSize: 7, color: 'var(--alice-muted)' }}>BUILT IN</span>
            ) : (
              <button
                type="button"
                className="font-pixel cursor-pointer"
                style={{ fontSize: 7, padding: '6px 10px', border: '1px solid var(--alice-border)', borderRadius: 2, background: 'transparent', color: 'var(--alice-muted)' }}
                onClick={() => {
                  removeInstalledLanguage(lang);
                  refresh();
                }}
              >
                REMOVE
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" style={{ ...btnBase, marginTop: 12 }} onClick={() => setPickerOpen(true)}>
        ADD A LANGUAGE
      </button>

      {pickerOpen && (
        <LearnLanguageModal
          currentLang={installed[0] ?? 'en'}
          onSelect={refresh}
          onClose={() => {
            setPickerOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
