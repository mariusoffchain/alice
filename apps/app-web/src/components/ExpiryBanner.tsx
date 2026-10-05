'use client';

import { SvgIcon } from '@/components/SvgIcon';
import { CLOCK_ICON, CLOSE_ICON, NEXT_ICON } from '@/lib/atelier-icons';

import { useEffect, useState } from 'react';
import { useAccount } from '@alice-wallet/alice-ai';
import { useOpenSettings } from '@/lib/settings-url';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** The same three days the server waits before mailing the first reminder. */
const WARNING_MS = 3 * DAY_MS;

const AMBER = 'var(--alice-warning)';

/** Dismissals are remembered per deadline, so a new plan warns again. */
const DISMISS_KEY = 'alice_expiry_notice_dismissed_v1';

/**
 * A plan about to run out, said where the user actually is.
 *
 * The account screen already carries this warning, but nobody visits the
 * account screen on the day their plan lapses. A Bitcoin plan cannot renew
 * itself, so the difference between a warning seen and a warning filed away is
 * the difference between a renewal and a user who opens Alice one morning and
 * finds their capacity gone with no explanation.
 *
 * It stays a strip and not a dialog on purpose. Nothing here is urgent enough
 * to interrupt a conversation, and a modal that blocks the app to sell
 * something would be exactly the pressure Alice does not apply.
 */
export function ExpiryBanner() {
  const account = useAccount();
  const openSettings = useOpenSettings();

  // Design review without a paid plan to look at, the same way the account tab
  // previews its own states. Dev only, applied after mount.
  const [preview, setPreview] = useState<number | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const key = new URLSearchParams(window.location.search).get('expiry-preview');
    if (key === 'soon') setPreview(Date.now() + 2 * DAY_MS);
    if (key === 'today') setPreview(Date.now() + 3 * 60 * 60 * 1_000);
    if (key === 'ended') setPreview(Date.now() - 1_000);
  }, []);

  const usage = account.cloudUsage;
  const expiresAt = preview ?? (usage?.kind === 'paid' ? usage.expiresAt : null);

  // Read after mount, never during render: the server cannot see local storage
  // and disagreeing about it is a hydration error.
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DISMISS_KEY);
      setDismissed(raw === null ? null : Number(raw));
    } catch { /* no memory of a dismissal is the safe direction */ }
  }, []);

  if (expiresAt === null) return null;
  if (dismissed === expiresAt) return null;

  const msLeft = expiresAt - Date.now();
  if (msLeft > WARNING_MS) return null;

  const dismiss = () => {
    setDismissed(expiresAt);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(expiresAt));
    } catch { /* it will simply show again */ }
  };

  const message = msLeft <= 0
    ? 'Your plan has ended. You are back on the free allowance.'
    : msLeft <= DAY_MS
      ? 'Your plan ends today. Nothing renews on its own.'
      : `Your plan ends in ${Math.ceil(msLeft / DAY_MS)} days. Nothing renews on its own.`;

  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 py-2 shrink-0"
      style={{
        backgroundColor: 'var(--alice-bg-soft)',
        borderBottom: `2px solid ${AMBER}`,
      }}
    >
      <span style={{ color: AMBER }}><SvgIcon svg={CLOCK_ICON} size={20} /></span>
      <span
        className="font-numbers flex-1 min-w-0"
        style={{ fontSize: 14, lineHeight: '19px', color: AMBER }}
      >
        {message}
      </span>
      <button
        type="button"
        onClick={() => openSettings('account')}
        className="alice-control alice-control--primary shrink-0"
        style={{ padding: '6px 12px' }}
      >
        Renew <SvgIcon svg={NEXT_ICON} size={16} />
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss plan expiry notice"
        className="alice-control alice-control--tool shrink-0"
        style={{ color: AMBER }}
      >
        <SvgIcon svg={CLOSE_ICON} size={16} />
      </button>
    </div>
  );
}
