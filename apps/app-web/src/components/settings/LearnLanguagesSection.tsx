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
import { SectionLabel, sectionStyle } from './ui';

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
        Languages available in the Learn quick selector. Plan ₿ Academy content exists in {`${28}`} languages. This does not change Alice’s response language.
      </p>
      <div className="flex flex-col" style={{ marginTop: 12 }}>
        {installed.map((lang, index) => (
          <div
            key={lang}
            className="flex items-center gap-3"
            style={{ padding: '10px 12px', borderTop: index > 0 ? '1px solid var(--alice-border)' : undefined }}
          >
            <span className="font-numbers" style={{ fontSize: 13, width: 64, color: 'var(--alice-primary)' }}>
              {lang.toUpperCase()}
            </span>
            <span className="font-numbers flex-1" style={{ fontSize: 14, color: 'var(--alice-text)' }}>
              {languageName(lang)}
            </span>
            {isEmbeddedLang(lang) ? (
              <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>Built in · available</span>
            ) : (
              <button
                type="button"
                className="alice-control alice-control--quiet font-numbers cursor-pointer"
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
      <button className="alice-control alice-control--quiet font-numbers" type="button" style={{ marginTop: 12 }} onClick={() => setPickerOpen(true)}>
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
