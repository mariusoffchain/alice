'use client';

import { useState } from 'react';

// First-open welcome for the Explorer section. Shown every time the section
// mounts until the user ticks "don't show this again" and confirms; a plain OK
// (or a backdrop click) closes it for now but lets it come back next visit.

const KEY = 'explorer.intro-dismissed.v1';

export function wasIntroDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    // Storage unavailable: never nag a user we cannot remember.
    return true;
  }
}

export function ExplorerIntroModal({ onClose }: { onClose: () => void }) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  function confirm() {
    if (dontShowAgain) {
      try {
        window.localStorage.setItem(KEY, '1');
      } catch {
        // Best effort: worst case the intro shows again.
      }
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          padding: 18,
          backgroundColor: 'var(--alice-bg)',
          border: '2px solid var(--alice-border)',
          borderRadius: 2,
          color: 'var(--alice-text)',
        }}
      >
        <h3
          className="font-pixel tracking-widest m-0"
          style={{ fontSize: 13, color: 'var(--alice-primary-dark)' }}
        >
          WELCOME TO EXPLORER
        </h3>
        <p
          className="font-numbers m-0 mt-3"
          style={{ fontSize: 15, lineHeight: '21px', opacity: 0.85 }}
        >
          Explorer browses the Bitcoin chain with a privacy lens. Search a transaction,
          an address or a block, follow the coins, and see what the chain quietly reveals.
        </p>
        <p
          className="font-numbers m-0 mt-2"
          style={{ fontSize: 15, lineHeight: '21px', opacity: 0.85 }}
        >
          Everything here is deterministic, on-chain data. Alice, the AI companion, is
          strictly optional.
        </p>

        <div className="flex items-center justify-between gap-3 mt-5">
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
            className="font-pixel tracking-widest cursor-pointer"
            style={{
              fontSize: 10,
              padding: '10px 22px',
              border: '2px solid var(--alice-primary)',
              borderRadius: 2,
              backgroundColor: 'var(--alice-primary)',
              color: 'var(--alice-on-primary)',
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
