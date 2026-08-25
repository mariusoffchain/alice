'use client';

import { useEffect, useState } from 'react';

// What an unsigned build does to a first-time visitor, said before it happens
// rather than after.
//
// Alice ships without a code-signing certificate: Apple charges yearly for
// one, Windows certificates cost more, and neither is worth buying before we
// know anyone runs those builds. The cost is not technical, it is a scary
// screen at the worst possible moment: someone who has just decided to try a
// Bitcoin wallet is told their computer protected them from it.
//
// Saying it first turns an alarm into a formality. It also happens to be the
// honest thing: the warning is real, it is our doing, and the visitor deserves
// to know why before they click, not to discover it alone.
//
// Linux and the web surfaces show nothing, because nothing happens there.

export type DownloadPlatform = 'android' | 'windows' | 'macos';

type Notice = {
  title: string;
  /** Verbatim, so the visitor recognises the screen when it appears. */
  screen: string;
  why: string;
  steps: string[];
};

const NOTICES: Record<DownloadPlatform, Notice> = {
  android: {
    title: 'Android will warn you before installing',
    screen: '“For your security, your phone is not allowed to install unknown apps from this source.”',
    why: 'Alice is not on the Play Store yet, so you are installing the file directly. Android asks for permission the first time any app does that.',
    steps: [
      'Open the downloaded file.',
      'When Android asks, allow installs from your browser or file manager.',
      'Come back to the file and install.',
    ],
  },
  windows: {
    title: 'Windows will show a blue warning',
    screen: '“Windows protected your PC”, with only a “Don’t run” button in sight.',
    why: 'The installer is not signed with a paid certificate. That certificate proves who published the file, and nothing about what the file does, so its absence is not a verdict on Alice. We have not bought one yet.',
    steps: [
      'Click “More info”, the small grey link.',
      'Then click “Run anyway”.',
    ],
  },
  macos: {
    title: 'macOS will refuse to open Alice at first',
    screen: '“Alice” Not Opened. “Apple could not verify ‘Alice’ is free of malware that may harm your Mac or compromise your privacy.”',
    why: 'Apple signing is in progress but not ready, and macOS says this about every unsigned app, whoever wrote it. The dialog itself offers no way through: the only buttons are Done and Move to Bin. The permission is given in System Settings instead.',
    steps: [
      'Drag Alice into Applications, then open it once. On the warning, click Done, never Move to Bin.',
      'Open the Apple menu, then System Settings, then Privacy and Security.',
      'Scroll down to Security. A line says Alice was blocked, with an Open Anyway button. Click it, authenticate, then confirm Open.',
      'That line only stays for a while after a blocked launch. If it is not there, open Alice again and come back to this screen.',
    ],
  },
};

export function DownloadNotice({
  platform,
  href,
  verifyHref,
  onCancel,
}: {
  platform: DownloadPlatform;
  href: string;
  verifyHref: string;
  onCancel: () => void;
}) {
  const notice = NOTICES[platform];
  // The steps are needed *after* the download, when the operating system puts
  // its warning on screen. Closing this dialog on the download click threw
  // them away at exactly the moment they became useful, so the click starts
  // the file and leaves the instructions standing.
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      // Before the download, a click outside is a way out. After it, it is a
      // stray click that would take the steps away mid-install; the close
      // button and Escape stay, and they are deliberate.
      onClick={started ? undefined : onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={notice.title}
        onClick={event => event.stopPropagation()}
        className="relative flex max-h-[calc(100vh-4rem)] w-full max-w-lg flex-col rounded-[6px] border-2"
        style={{
          borderColor: 'var(--alice-border)',
          backgroundColor: 'var(--alice-bg)',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="absolute right-3 top-3 cursor-pointer bg-transparent px-2 py-1 text-lg leading-none text-[var(--alice-muted)]"
        >
          ×
        </button>

        <div className="shrink-0 px-6 pt-6">
          <p className="font-pixel text-[11px] uppercase tracking-widest text-[var(--alice-primary)] pr-8">
            {started ? 'While it downloads' : 'Before you download'}
          </p>
          <h2 className="mt-3 text-xl font-semibold text-[var(--alice-heading)] sm:text-2xl">
            {notice.title}
          </h2>

          {started && (
            <p className="mt-3 text-sm leading-relaxed text-[var(--alice-primary)]">
              Your download has started. These steps stay on screen until you
              close them, because you will need them when the warning appears.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          <p
            className="mt-4 rounded-[4px] border-l-2 px-4 py-3 text-[15px] leading-relaxed"
            style={{
              borderColor: 'var(--alice-primary)',
              backgroundColor: 'var(--alice-bg-soft)',
              color: 'var(--alice-text)',
            }}
          >
            {notice.screen}
          </p>

          <p className="mt-4 leading-relaxed text-[var(--alice-text)]">{notice.why}</p>

          <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 leading-relaxed text-[var(--alice-text)]">
            {notice.steps.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <p className="mt-5 text-sm leading-relaxed text-[var(--alice-muted)]">
            Alice is open source, and every release publishes the checksum of each
            file. You can verify that what you downloaded is exactly what we
            published:{' '}
            <a
              href={verifyHref}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: 'var(--alice-primary)' }}
            >
              release notes and checksums
            </a>
            .
          </p>
        </div>

        <div className="shrink-0 flex flex-wrap items-center justify-end gap-3 px-6 pb-6 pt-4">
          {started ? (
            <>
              <a
                href={href}
                className="cursor-pointer px-3 py-2 text-sm text-[var(--alice-muted)] underline"
              >
                Download again
              </a>
              <button
                type="button"
                onClick={onCancel}
                className="cta cta-solid px-5 py-2.5 text-sm"
              >
                Close
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="cursor-pointer bg-transparent px-3 py-2 text-sm text-[var(--alice-muted)]"
              >
                Cancel
              </button>
              <a
                href={href}
                onClick={() => setStarted(true)}
                className="cta cta-solid px-5 py-2.5 text-sm"
              >
                Download anyway
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
