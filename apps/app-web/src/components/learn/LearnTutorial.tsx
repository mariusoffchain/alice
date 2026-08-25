'use client';

import { useEffect, useState } from 'react';
import type { LearnTutorialPack } from '@alice-wallet/alice-content/src/learn-types';
import { TUTORIAL_CATEGORY_LABELS } from '@/lib/learn/catalog';
import type { LearnLang } from '@/lib/learn/language';
import { openExternalUrl } from '@/lib/open-external';
import { fetchTutorialPack } from '@/lib/learn/packs';
import { LearnMarkdown } from './LearnMarkdown';

const ui = (lang: string): 'fr' | 'en' => (lang === 'fr' ? 'fr' : 'en');

export function LearnTutorial({
  category,
  slug,
  lang,
}: {
  category: string;
  slug: string;
  lang: LearnLang;
}) {
  const [pack, setPack] = useState<LearnTutorialPack | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPack(null);
    setError(false);
    fetchTutorialPack(lang, category, slug)
      .then((p) => { if (!cancelled) setPack(p); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [lang, category, slug]);

  if (error) {
    return (
      <div style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '48px 0' }}>
        <p className="font-numbers" style={{ color: 'var(--alice-muted)' }}>
          {lang === 'fr' ? 'Tutoriel indisponible dans cette langue.' : 'Tutorial unavailable in this language.'}
        </p>
      </div>
    );
  }
  if (!pack) {
    return (
      <div style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '48px 0' }}>
        <p className="font-pixel" style={{ fontSize: 9, color: 'var(--alice-muted)' }}>LOADING…</p>
      </div>
    );
  }

  return (
    <div style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '24px 0 72px', color: 'var(--alice-text)' }}>
      <div className="font-pixel" style={{ fontSize: 8, color: 'var(--alice-muted)' }}>
        {(TUTORIAL_CATEGORY_LABELS[category]?.[ui(lang)] ?? category).toUpperCase()}
      </div>
      <h1 className="font-pixel" style={{ fontSize: 14, lineHeight: '24px', margin: '12px 0 4px' }}>{pack.name}</h1>
      {pack.description && (
        <p className="font-numbers" style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--alice-muted)' }}>{pack.description}</p>
      )}

      <LearnMarkdown markdown={pack.markdown} assetBase={pack.assetBase} videos={{}} lang={lang} />

      <p className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)', marginTop: 32 }}>
        {lang === 'fr' ? 'Contenu ' : 'Content by '}
        <a href="https://planb.network" target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); void openExternalUrl('https://planb.network'); }} style={{ color: 'var(--alice-muted)', textDecoration: 'underline' }}>
          Plan ₿ Network
        </a>
        {' · CC BY-SA 4.0'}
      </p>
    </div>
  );
}
