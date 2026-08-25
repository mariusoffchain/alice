'use client';

import { AliceMemoryPanel } from '@/components/settings/AliceMemoryPanel';

// The standalone route is now a thin frame around the shared panel, so the
// same screen serves both here and inside the settings dialog. Everything that
// was this page lives in AliceMemoryPanel.
export default function WhatAliceKnowsPage() {
  return (
    <main style={{ width: 'min(100% - 32px, 760px)', margin: '0 auto', padding: '48px 0 72px' }}>
      <a href="/" className="font-pixel" style={{ color: 'var(--alice-muted)', fontSize: 10, textDecoration: 'none' }}>BACK TO ALICE</a>
      <div style={{ marginTop: 24 }}>
        <AliceMemoryPanel />
      </div>
    </main>
  );
}
