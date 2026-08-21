'use client';

import { useEffect, useState } from 'react';
import { useAccount, type AliceBilling, type AliceCloudUsage } from '@alice-wallet/alice-ai';
import { isBillingPreview, PREVIEW_ACCOUNT_NAME } from './billing-preview';
import { PlanCheckout } from './PlanCheckout';
import { RenewalReminders } from './RenewalReminders';
import { btnBase, SectionHint, SectionLabel, sectionStyle } from './ui';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Matches the server's reminder window, so the app and the emails agree. */
const EXPIRY_WARNING_MS = 3 * DAY_MS;

const AMBER = '#d99a2b';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const PLAN_LABELS: Record<string, string> = {
  free: 'FREE',
  cloud: 'CLOUD',
  cloud_plus: 'CLOUD+',
};

/** The same names, cased for the middle of a sentence. */
const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  cloud: 'Cloud',
  cloud_plus: 'Cloud+',
};

/**
 * The one gauge this tab shows. Percent-only on paid plans, on purpose: the
 * server meters encrypted bytes, so a token figure would be an estimate
 * dressed up as a measurement. The free plan's request counter is exact and
 * is rendered as counts by the caller instead.
 */
function UsageBar({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.7 }}>
          {label}
        </span>
        <span className="font-numbers" style={{ fontSize: 15 }}>{clamped}%</span>
      </div>
      <div
        className="mt-2"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 12,
          border: '2px solid var(--alice-border)',
          borderRadius: 2,
          backgroundColor: 'var(--alice-bg)',
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            backgroundColor: clamped >= 90 ? AMBER : 'var(--alice-primary)',
          }}
        />
      </div>
    </div>
  );
}

/**
 * Design-review states, reachable only from a dev build via
 * `?billing-preview=cloud|expiring|expired|reminder`. The paid
 * states need a
 * settled Bitcoin payment to exist for real, so without this the only way to
 * review them would be to pay. `NODE_ENV` gating keeps the whole map out of a
 * production bundle.
 */
function previewState(now: number): { usage: AliceCloudUsage; billing: AliceBilling } | null {
  if (process.env.NODE_ENV === 'production') return null;
  const params = new URLSearchParams(window.location.search);
  // A settled payment implies a paid account, so previewing the confirmation
  // without also previewing the plan would show a screen that cannot exist:
  // a thank-you note above a free counter.
  const key = params.get('billing-preview')
    ?? (params.get('checkout-preview') === 'settled' ? 'cloud' : null);
  if (!key) return null;

  const base: AliceBilling = {
    plan: 'cloud',
    purchased_plan: 'cloud',
    plan_expires_at: now + 17 * DAY_MS,
    expired: false,
    period_started_at: now - 13 * DAY_MS,
    period_ends_at: now + 17 * DAY_MS,
    usage_percent: 43,
    input_bytes_used: 12_700_000,
    input_bytes_limit: 29_600_000,
    output_bytes_used: 1_900_000,
    output_bytes_limit: 7_400_000,
    billing_email_masked: null,
  };
  const paidUsage = (billing: AliceBilling): AliceCloudUsage => ({
    kind: 'paid',
    plan: billing.plan as 'cloud',
    percentUsed: billing.usage_percent ?? 0,
    periodEndsAt: billing.period_ends_at,
    expiresAt: billing.plan_expires_at ?? now,
  });

  if (key === 'cloud') return { usage: paidUsage(base), billing: base };
  if (key === 'expiring') {
    const billing = { ...base, plan_expires_at: now + 2 * DAY_MS, period_ends_at: now + 2 * DAY_MS, usage_percent: 91 };
    return { usage: paidUsage(billing), billing };
  }
  if (key === 'reminder') {
    // The other half of the reminders card: an address already given.
    const billing = { ...base, billing_email_masked: 's...i@example.com' };
    return { usage: paidUsage(billing), billing };
  }
  if (key === 'expired') {
    const billing = { ...base, plan: 'free' as const, expired: true, plan_expires_at: now - 4 * DAY_MS, usage_percent: null };
    return { usage: { kind: 'free', remaining: 0, limit: 21 }, billing };
  }
  return null;
}

export function AccountTab() {
  const account = useAccount();

  // The snapshot may be minutes old when the user opens settings, and this is
  // exactly the screen where a stale figure misleads. One refresh on entry.
  useEffect(() => {
    void account.refreshAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = Date.now();
  // Applied after mount, never during render: the server cannot see the query
  // string, and a server/client disagreement here is a hydration error.
  const [preview, setPreview] = useState<ReturnType<typeof previewState>>(null);
  useEffect(() => {
    setPreview(previewState(Date.now()));
  }, []);
  const usage = preview?.usage ?? account.cloudUsage;
  const billing = preview?.billing ?? account.billing;

  const paid = usage?.kind === 'paid' ? usage : null;
  const free = usage?.kind === 'free' ? usage : null;
  const expiresSoon = paid !== null && paid.expiresAt - now <= EXPIRY_WARNING_MS;
  // `purchased_plan` outlives the plan itself, which is what lets this screen
  // tell "never paid" apart from "paid, and it lapsed".
  const lapsed = billing !== null && billing.expired;
  // A previewed plan implies a previewed account: see billing-preview.ts.
  const signedInAs = preview !== null
    ? PREVIEW_ACCOUNT_NAME
    : account.account
      ? account.account.username ?? account.account.display_name ?? 'Signed in'
      : null;

  return (
    <div>
      {/* What plan this account holds, and until when. */}
      <section style={sectionStyle}>
        <SectionLabel>PLAN</SectionLabel>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="font-pixel tracking-widest" style={{ fontSize: 14 }}>
            {PLAN_LABELS[paid ? paid.plan : 'free']}
          </span>
          {paid && (
            <span className="font-numbers" style={{ fontSize: 14, opacity: 0.6 }}>
              until {formatDate(paid.expiresAt)}
            </span>
          )}
        </div>

        {paid && expiresSoon && (
          <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, color: AMBER }}>
            {paid.expiresAt - now <= DAY_MS
              ? 'Your plan ends today.'
              : `Your plan ends on ${formatDate(paid.expiresAt)}.`}
            {' '}Bitcoin payments cannot renew on their own, so nothing happens
            unless you choose to renew.
          </p>
        )}

        {lapsed && (
          <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, opacity: 0.7 }}>
            Your {PLAN_NAMES[billing.purchased_plan] ?? ''} plan ended
            {billing.plan_expires_at ? ` on ${formatDate(billing.plan_expires_at)}` : ''}.
            Your wallet, your local AI and your data are not affected. You are
            back on the free allowance.
          </p>
        )}

        {!paid && !lapsed && (
          <SectionHint>
            The wallet, the local AI and your data stay free. Paid plans only
            add Private Cloud capacity.
          </SectionHint>
        )}
      </section>

      {/* How much of it has been used. */}
      <section style={sectionStyle}>
        <SectionLabel>USAGE</SectionLabel>
        <div className="mt-3">
          {paid ? (
            <>
              <UsageBar percent={paid.percentUsed} label="THIS MONTH" />
              {paid.periodEndsAt !== null && (
                <p className="font-numbers m-0 mt-2" style={{ fontSize: 13, opacity: 0.6 }}>
                  Allowance resets on {formatDate(paid.periodEndsAt)}.
                </p>
              )}
              <p className="font-numbers m-0 mt-4" style={{ fontSize: 13, opacity: 0.5 }}>
                Usage is estimated from the volume of data exchanged. Your
                messages are end-to-end encrypted, Alice cannot read them, so
                the exact token count is not accessible to her.
              </p>
            </>
          ) : free ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.7 }}>
                  PRIVATE CLOUD REQUESTS
                </span>
                <span className="font-numbers" style={{ fontSize: 15 }}>
                  {free.remaining} / {free.limit} left
                </span>
              </div>
              <SectionHint>
                Free requests are counted exactly, and they work without an
                account. Local AI is unlimited and never counted.
              </SectionHint>
            </>
          ) : (
            <SectionHint>Sign in to see your Private Cloud usage.</SectionHint>
          )}
        </div>
      </section>

      {/* Buying, renewing, or waiting for a payment to settle. */}
      <PlanCheckout />

      {/* Only once there is a plan to be reminded about. Offering this to
          someone on the free allowance would be asking for an address to warn
          them about an expiry that cannot happen. */}
      {(paid || lapsed) && <RenewalReminders />}

      {/* The account row: who is signed in, or the invitation to be. */}
      <section style={sectionStyle}>
        <SectionLabel>ALICE ACCOUNT</SectionLabel>
        <div className="mt-3 flex items-center justify-between gap-4">
          <span className="font-numbers truncate" style={{ fontSize: 15 }}>
            {signedInAs ?? 'Not signed in'}
          </span>
          <button
            type="button"
            className="font-pixel"
            style={{
              ...btnBase,
              backgroundColor: 'var(--alice-bg)',
              color: 'var(--alice-primary-dark)',
            }}
            onClick={() => account.requestSignIn()}
          >
            {signedInAs ? 'MANAGE' : 'SIGN IN'}
          </button>
        </div>
        {account.account?.email_masked && (
          <p className="font-numbers m-0 mt-2" style={{ fontSize: 13, opacity: 0.6 }}>
            {account.account.email_masked}
          </p>
        )}
      </section>
    </div>
  );
}
