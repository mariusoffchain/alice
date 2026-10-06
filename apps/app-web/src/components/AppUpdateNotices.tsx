'use client';

import { useEffect, useRef, useState } from 'react';
import { SvgIcon } from '@/components/SvgIcon';
import { useDialogFocus } from '@/components/settings/ui';
import { EXTERNAL_ICON, REFRESH_ICON, CLOSE_ICON } from '@/lib/atelier-icons';
import { OPEN_WHATS_NEW_EVENT } from '@/lib/update-notices';
import {
  RELEASE_NOTES_URL, checkForAppUpdate, currentAppVersion, isTauriDesktop,
  pendingWhatsNew, acknowledgeWhatsNew, whatsNewFor,
} from '@alice-wallet/alice-ai';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1_000;
const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};
type Details = { version: string; mode: 'installed' | 'available' | 'manual' };

function UpdateAction() {
  return isTauriDesktop() ? (
    <a href={RELEASE_NOTES_URL} target="_blank" rel="noreferrer" className="alice-control alice-control--primary">
      Get the update <SvgIcon svg={EXTERNAL_ICON} size={16} />
    </a>
  ) : (
    <button type="button" onClick={() => window.location.reload()} className="alice-control alice-control--primary">
      <SvgIcon svg={REFRESH_ICON} size={16} /> Reload to update
    </button>
  );
}

function UpdateDetails({ details, onClose }: { details: Details; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(true, ref);
  const notes = whatsNewFor(details.version);
  const available = details.mode === 'available';
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="alice-update-title" aria-describedby="alice-update-summary"
        onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
        className="font-numbers w-full" style={{ maxWidth: 520, maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', padding: 24,
          background: 'var(--alice-bg)', color: 'var(--alice-text)', border: '1px solid var(--alice-border)', borderRadius: 'var(--alice-radius-field)' }}>
        <div className="flex items-center justify-between gap-4">
          <span className="font-pixel" style={{ fontSize: 10, color: 'var(--alice-primary)' }}>ALICE {details.version}</span>
          <button type="button" aria-label="Close update details" onClick={onClose} className="alice-control alice-control--icon alice-control--quiet">
            <SvgIcon svg={CLOSE_ICON} size={16} />
          </button>
        </div>
        <h2 id="alice-update-title" className="font-pixel mt-4 mb-3" style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--alice-heading)' }}>
          {available ? 'UPDATE AVAILABLE' : "WHAT’S NEW"}
        </h2>
        <p id="alice-update-summary" className="m-0" style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--alice-muted)' }}>
          {available ? 'A newer version of Alice is ready. Update when you have finished your conversation.'
            : details.mode === 'installed' ? 'Alice has been updated. Here is what changed in this version.'
              : 'Here is what changed in your current version of Alice.'}
        </p>
        {notes ? <ul className="my-5 pl-5 flex flex-col gap-3" style={{ fontSize: 15, lineHeight: 1.6 }}>
          {notes.highlights.map(line => <li key={line}>{line}</li>)}
        </ul> : <p className="my-5" style={{ fontSize: 15 }}>Read the release notes for the changes included in this version.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4" style={{ borderTop: '1px solid var(--alice-border)' }}>
          <a href={RELEASE_NOTES_URL} target="_blank" rel="noreferrer" className="alice-control alice-control--quiet" style={{ fontSize: 13 }}>
            Release history <SvgIcon svg={EXTERNAL_ICON} size={16} />
          </a>
          {available ? <UpdateAction /> : <button type="button" onClick={onClose} className="alice-control alice-control--primary">Continue</button>}
        </div>
      </div>
    </div>
  );
}

/** Available updates stay quiet; installed updates are acknowledged on dismissal. */
export function AppUpdateNotices() {
  const [latest, setLatest] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const demo = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const current = currentAppVersion();
    const open = () => { if (current) setDetails({ version: current, mode: 'manual' }); };
    window.addEventListener(OPEN_WHATS_NEW_EVENT, open);
    const showcase = process.env.NODE_ENV !== 'production' ? new URLSearchParams(window.location.search).get('update-demo') : null;
    demo.current = showcase !== null;
    if (demo.current) {
      if (current) {
        if (showcase === 'available') setLatest(current);
        else setDetails({ version: current, mode: 'installed' });
      }
      return () => window.removeEventListener(OPEN_WHATS_NEW_EVENT, open);
    }
    void pendingWhatsNew(storage, current).then(version => {
      if (!cancelled && version) setDetails({ version, mode: 'installed' });
    });
    const check = () => void checkForAppUpdate(storage).then(found => {
      if (!cancelled && found) setLatest(found);
    });
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(OPEN_WHATS_NEW_EVENT, open);
    };
  }, []);

  const close = () => {
    if (details && details.mode !== 'available' && !demo.current) void acknowledgeWhatsNew(storage, details.version);
    setDetails(null);
  };
  return <>
    {latest && !dismissed && <div role="status" className="alice-update-banner font-numbers">
      <div className="alice-update-banner-content">
        <span>Alice {latest} is available</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setDetails({ version: latest, mode: 'available' })} className="alice-control alice-control--quiet">What’s new</button>
          <UpdateAction />
        </div>
      </div>
      <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss update notice" className="alice-control alice-control--icon alice-control--quiet"><SvgIcon svg={CLOSE_ICON} size={16} /></button>
    </div>}
    {details && <UpdateDetails details={details} onClose={close} />}
  </>;
}
