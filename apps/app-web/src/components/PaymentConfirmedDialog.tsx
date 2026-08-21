'use client';

import { useEffect, useState } from 'react';
import { useAccount } from '@alice-wallet/alice-ai';

const PLAN_NAMES: Record<string, string> = {
  cloud: 'Cloud',
  cloud_plus: 'Cloud+',
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The moment a Bitcoin payment lands.
 *
 * It is a dialog, and it lives at the top of the app rather than inside the
 * account screen, because a payment settles on the network's schedule and not
 * on the user's: the webhook can arrive minutes later, while they are in the
 * middle of a conversation and nowhere near settings. Announcing it where they
 * are is the whole point. Dismissing it drops them back into an app whose
 * account is already credited, since the plan is read from the same billing
 * snapshot that proved the payment settled.
 */
export function PaymentConfirmedDialog() {
  const account = useAccount();

  // Design review without a settled payment to look at. Dev only, and applied
  // after mount so the server and the client render the same first pass.
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    setPreview(
      new URLSearchParams(window.location.search).get('checkout-preview') === 'settled',
    );
  }, []);

  const [dismissedPreview, setDismissedPreview] = useState(false);
  const showPreview = preview && !dismissedPreview;

  if (!account.checkoutSettled && !showPreview) return null;

  const billing = account.billing;
  const plan = showPreview ? 'cloud' : billing?.plan ?? 'cloud';
  const expiresAt = showPreview
    // The same fake expiry the account tab previews, so the two do not
    // contradict each other on screen during a design review.
    ? Date.now() + 17 * 24 * 60 * 60 * 1_000
    : billing?.plan_expires_at ?? null;

  const done = () => {
    setDismissedPreview(true);
    account.acknowledgeCheckout();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-5"
      style={{ backgroundColor: 'rgba(0,0,0,0.68)' }}
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) done();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="alice-payment-confirmed-title"
        className="w-full"
        style={{
          maxWidth: 420,
          padding: 20,
          border: '2px solid var(--alice-primary)',
          borderRadius: 2,
          backgroundColor: 'var(--alice-bg)',
          color: 'var(--alice-text)',
        }}
      >
        <h2
          id="alice-payment-confirmed-title"
          className="font-pixel m-0 tracking-widest"
          style={{ fontSize: 10, lineHeight: '18px', color: 'var(--alice-primary)' }}
        >
          PAYMENT CONFIRMED
        </h2>

        <p
          className="font-numbers m-0 mt-3"
          style={{ fontSize: 16, lineHeight: '22px' }}
        >
          Your {PLAN_NAMES[plan] ?? 'Private Cloud'} plan is active
          {expiresAt !== null ? ` until ${formatDate(expiresAt)}` : ''}.
        </p>

        <p
          className="font-numbers m-0 mt-2"
          style={{ fontSize: 13, lineHeight: '19px', opacity: 0.6 }}
        >
          Nothing renews on its own and no payment method is stored. Alice will
          tell you before the plan runs out.
        </p>

        <button
          type="button"
          onClick={done}
          autoFocus
          className="font-pixel tracking-widest mt-5 w-full cursor-pointer"
          style={{
            padding: '10px 14px',
            border: '2px solid var(--alice-primary)',
            borderRadius: 2,
            backgroundColor: 'var(--alice-primary)',
            color: 'var(--alice-on-primary)',
            fontSize: 11,
          }}
        >
          DONE
        </button>
      </div>
    </div>
  );
}
