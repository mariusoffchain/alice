'use client';

import { useState } from 'react';
import { SvgIcon } from './SvgIcon';
import { CLOSE_ICON, WALLET_ICON, CHECK_ICON } from '@/lib/atelier-icons';

// First-open welcome for the Playground, same shell and dismissal mechanics
// as ExplorerIntroModal. This is the one place that says, calmly and once,
// what this space is and is not; the interface can then stop repeating
// warnings at every corner.
//
// When no practice wallet exists yet, the confirm button becomes the first
// step of the journey (create the wallet) instead of an obstacle before it.

const KEY = 'playground.intro-dismissed.v1';

export function wasPlaygroundIntroDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    // Storage unavailable: never nag a user we cannot remember.
    return true;
  }
}

export function PlaygroundIntroModal({
  hasWallet,
  onClose,
  onCreate,
}: {
  hasWallet: boolean;
  onClose: () => void;
  onCreate: () => void;
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  function persistDismissal() {
    if (dontShowAgain) {
      try {
        window.localStorage.setItem(KEY, '1');
      } catch {
        // Best effort: worst case the intro shows again.
      }
    }
  }

  function confirm() {
    persistDismissal();
    if (hasWallet) {
      onClose();
    } else {
      onCreate();
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to the Playground"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          padding: 20,
          maxHeight: 'calc(100dvh - 48px)',
          overflowY: 'auto',
          backgroundColor: 'var(--alice-bg)',
          border: '1px solid var(--alice-border)',
          borderRadius: 'var(--alice-radius-control)',
          color: 'var(--alice-text)',
        }}
      >
        <button type="button" onClick={onClose} aria-label="Close introduction"
          className="alice-control alice-control--tool float-right"><SvgIcon svg={CLOSE_ICON} size={16} /></button>
        <h3
          className="font-pixel tracking-widest m-0"
          style={{ fontSize: 12, lineHeight: 1.8, color: 'var(--alice-text)' }}
        >
          WELCOME TO THE PLAYGROUND
        </h3>
        <p
          className="font-numbers m-0 mt-3"
          style={{ fontSize: 15, lineHeight: '21px', color: 'var(--alice-muted)' }}
        >
          A real Bitcoin wallet, on a network where coins are free and
          worthless. Send, receive, back up: make every mistake here, and
          Alice explains each step as you go.
        </p>
        <p
          className="font-numbers m-0 mt-2"
          style={{ fontSize: 15, lineHeight: '21px', color: 'var(--alice-muted)' }}
        >
          This is not your real wallet. Nothing here has value, so nothing
          here can be lost.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--alice-primary)' }}
            />
            <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
              Don&apos;t show this again
            </span>
          </label>
          <button
            type="button"
            onClick={confirm}
            className="alice-control alice-control--primary"
          >
            <SvgIcon svg={hasWallet ? CHECK_ICON : WALLET_ICON} size={20} />
            {hasWallet ? 'OK' : 'Create my practice wallet'}
          </button>
        </div>
      </div>
    </div>
  );
}
