'use client';

import { useEffect, useState } from 'react';

let cachedMarkup: string | null = null;
let pendingFetch: Promise<string> | null = null;

async function loadLogoMarkup(): Promise<string> {
  if (cachedMarkup) return cachedMarkup;
  if (!pendingFetch) {
    pendingFetch = fetch('/alice-logo.svg')
      .then(res => res.text())
      .then(text => {
        cachedMarkup = text;
        return text;
      });
  }
  return pendingFetch;
}

interface AliceLogoProps {
  size?: number;
}

export function AliceLogo({ size = 20 }: AliceLogoProps) {
  const [markup, setMarkup] = useState(cachedMarkup);

  useEffect(() => {
    if (markup) return;
    let cancelled = false;
    loadLogoMarkup().then(text => {
      if (!cancelled) setMarkup(text);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [markup]);

  if (!markup) return <div style={{ width: size, height: size, flexShrink: 0 }} />;

  const sized = markup
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);

  return (
    <div
      style={{ width: size, height: size, flexShrink: 0, display: 'flex' }}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
}
