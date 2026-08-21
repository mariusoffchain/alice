'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isTauriDesktop } from '@alice-wallet/alice-ai';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { DEFAULT_SETTINGS_TAB, resolveSettingsTab } from '@/components/settings/tabs';

/**
 * The full-page settings surface. Everyday access goes through the dialog that
 * opens over the app; this route stays for deep links, the desktop shell and
 * anyone who lands on /settings directly. Both render the same SettingsPanel.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(DEFAULT_SETTINGS_TAB);

  // This route exists for deep links, so honour ?tab=. Applied after mount
  // rather than in the initial state to keep server and client renders equal.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested) setActiveTab(resolveSettingsTab(requested));
  }, []);

  return (
    <div
      className="h-screen flex flex-col"
      style={{ backgroundColor: 'var(--alice-bg)', color: 'var(--alice-text)' }}
    >
      {isTauriDesktop() && (
        <div data-tauri-drag-region className="shrink-0" style={{ height: 28 }} />
      )}

      <header className="flex items-center px-5 h-12 shrink-0">
        <button
          onClick={() => router.push('/')}
          className="font-pixel text-base bg-transparent border-none cursor-pointer p-0"
          style={{ color: 'var(--alice-text)', fontSize: 20 }}
          aria-label="Back"
        >
          &larr;
        </button>
        <h1
          className="font-pixel tracking-widest flex-1 text-center m-0"
          style={{ fontSize: 16 }}
        >
          SETTINGS
        </h1>
        <div className="w-9" />
      </header>

      <SettingsPanel activeTab={activeTab} onSelectTab={setActiveTab} />
    </div>
  );
}
