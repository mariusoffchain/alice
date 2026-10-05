'use client';

import { SvgIcon } from '@/components/SvgIcon';
import { EXTERNAL_ICON, REFRESH_ICON, CLOSE_ICON, NEXT_ICON } from '@/lib/atelier-icons';

import { useEffect, useState } from 'react';
import {
  RELEASE_NOTES_URL,
  checkForAppUpdate,
  currentAppVersion,
  isTauriDesktop,
  takeWhatsNew,
  whatsNewFor,
  type WhatsNewEntry,
} from '@alice-wallet/alice-ai';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1_000;

const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

/**
 * Two one-way doors, both quiet by default: a strip when a newer Alice is
 * released (reload on the web, download link on desktop), and a one-time
 * dialog after an update landed, showing what the new version carries. The
 * strip is not a dialog on purpose, an update never interrupts a
 * conversation.
 */
export function AppUpdateNotices() {
  const [latest, setLatest] = useState<string | null>(null);
  const [whatsNew, setWhatsNew] = useState<WhatsNewEntry | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Dev-only showcase: ?update-demo=1 renders both notices with fake data,
    // no storage touched. Compiled out of production builds.
    if (process.env.NODE_ENV !== 'production'
      && new URLSearchParams(window.location.search).has('update-demo')) {
      setLatest('0.3.0');
      setWhatsNew(whatsNewFor('0.2.0'));
      return undefined;
    }
    void takeWhatsNew(storage).then(version => {
      if (!cancelled && version) setWhatsNew(whatsNewFor(version));
    });
    const check = () => {
      void checkForAppUpdate(storage).then(found => {
        if (!cancelled && found) setLatest(found);
      });
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const desktop = isTauriDesktop();

  return (
    <>
      {/* One voice at a time: while the what's-new dialog is open, the update
          strip waits. In real life they rarely coincide (the dialog belongs
          to the version just installed, the strip to the next one), but when
          they do, "here is what you got" comes before "there is more". */}
      {latest && !dismissed && !whatsNew && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-[90] flex flex-wrap items-center justify-center gap-3 px-4 py-2.5"
          style={{
            backgroundColor: 'var(--alice-bg-soft)',
            borderTop: '2px solid var(--alice-primary)',
          }}
        >
          <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-heading)' }}>
            ALICE {latest} IS OUT
          </span>
          {desktop ? (
            <a
              href={RELEASE_NOTES_URL}
              target="_blank"
              rel="noreferrer"
              className="alice-control alice-control--primary"
              style={{ padding: '6px 10px' }}
            >
              <SvgIcon svg={EXTERNAL_ICON} size={16} /> Get the update
            </a>
          ) : (
            <button
              onClick={() => window.location.reload()}
              className="alice-control alice-control--primary"
              style={{ padding: '6px 10px' }}
            >
              <SvgIcon svg={REFRESH_ICON} size={20} /> Reload to update
            </button>
          )}
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss update notice"
            className="alice-control alice-control--quiet"
            style={{  }}
          >
            <SvgIcon svg={CLOSE_ICON} size={16} /> Later
          </button>
        </div>
      )}

      {whatsNew && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setWhatsNew(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onKeyDown={(event) => { if (event.key === 'Escape') setWhatsNew(null); }}
            aria-label={`What's new in Alice ${whatsNew.version}`}
            onClick={event => event.stopPropagation()}
            style={{
              maxWidth: 420,
              width: '100%',
              backgroundColor: 'var(--alice-bg)',
              border: '2px solid var(--alice-border)',
              borderRadius: 3,
              padding: 20,
            }}
          >
            <p className="font-pixel tracking-widest m-0" style={{ fontSize: 10, color: 'var(--alice-primary)' }}>
              ALICE {whatsNew.version}
            </p>
            <h2 className="font-pixel tracking-widest mt-2 mb-0" style={{ fontSize: 12, color: 'var(--alice-heading)' }}>
              WHAT&apos;S NEW
            </h2>
            <ul className="m-0 mt-4 flex flex-col gap-2 pl-4">
              {whatsNew.highlights.map(line => (
                <li key={line} className="font-numbers" style={{ fontSize: 14, lineHeight: '19px', color: 'var(--alice-text)' }}>
                  {line}
                </li>
              ))}
            </ul>
            <p className="font-numbers mt-4 mb-0" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
              Bug fixes and the full detail:{' '}
              <a className="alice-control alice-control--quiet"
                href={RELEASE_NOTES_URL}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'underline' }}
              >
                release notes <span style={{ display: 'inline-flex', verticalAlign: 'middle' }}><SvgIcon svg={EXTERNAL_ICON} size={16} /></span>
              </a>
              .
            </p>
            <div className="mt-5 flex justify-end">
              <button
                autoFocus
                onClick={() => setWhatsNew(null)}
                className="alice-control alice-control--primary"
                style={{ padding: '8px 14px' }}
              >
                <SvgIcon svg={NEXT_ICON} size={16} /> Explore
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
