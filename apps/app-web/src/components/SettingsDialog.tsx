'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { resolveSettingsTab } from '@/components/settings/tabs';
import { SETTINGS_PARAM, settingsHref, withoutSettingsHref } from '@/lib/settings-url';

/**
 * Settings as a dialog over the app rather than a page that replaces it: the
 * conversation stays visible behind, and closing returns exactly where the user
 * was. Mounted once at the app root; it renders nothing until `?settings=` is
 * present in the URL.
 *
 * Rendered on the client only, deliberately. The panel reads things the server
 * cannot see, and its tabs load account state the moment they mount, so the
 * markup the server streams for it is out of date before hydration reaches it:
 * arriving at `?settings=account` used to throw a hydration mismatch for
 * exactly that reason. A modal opened from a query string has nothing to gain
 * from server rendering anyway, and skipping it removes the whole class of
 * mismatch rather than the one instance that was noticed.
 */
export function SettingsDialog() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get(SETTINGS_PARAM);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const open = mounted && requested !== null;
  const activeTab = resolveSettingsTab(requested);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') router.push(withoutSettingsHref());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, router]);

  // The page behind must not scroll while the dialog is up.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  if (!open) return null;

  const close = () => router.push(withoutSettingsHref());

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-0 sm:p-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 70 }}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
        className="flex flex-col w-full h-full sm:h-[min(680px,90vh)] sm:max-w-4xl"
        style={{
          backgroundColor: 'var(--alice-bg)',
          color: 'var(--alice-text)',
          border: '2px solid var(--alice-border)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <header
          className="flex items-center justify-between gap-3 px-4 shrink-0 border-b"
          style={{ height: 48, borderColor: 'var(--alice-border)' }}
        >
          <h2 className="font-pixel tracking-widest m-0" style={{ fontSize: 12 }}>
            SETTINGS
          </h2>
          <button
            onClick={close}
            className="w-8 h-8 flex items-center justify-center cursor-pointer bg-transparent border-none outline-none opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--alice-text)', fontSize: 18, lineHeight: 1 }}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>

        <SettingsPanel
          activeTab={activeTab}
          onSelectTab={(id) => router.replace(settingsHref(id))}
        />
      </div>
    </div>
  );
}
