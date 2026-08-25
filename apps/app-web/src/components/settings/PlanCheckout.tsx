'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getPlanQuotes,
  useAccount,
  type AlicePaidPlan,
  type AlicePendingCheckout,
  type AlicePlanQuotes,
} from '@alice-wallet/alice-ai';
import { isBillingPreview } from './billing-preview';
import { btnBase, SectionHint, SectionLabel, sectionStyle } from './ui';

const MONTH_CHOICES = [1, 3, 6, 12];

const PLANS: {
  id: AlicePaidPlan;
  name: string;
  pitch: string;
}[] = [
  {
    id: 'cloud',
    name: 'CLOUD',
    pitch: '8M input and 2M output tokens of Private Cloud each month.',
  },
];

/**
 * The price. Satoshis, because that is the unit the invoice is in and the unit
 * the buyer pays in.
 */
function formatSats(sats: number): string {
  return `${sats.toLocaleString('en-US')} SATS`;
}

const CURRENCY_SYMBOL: Record<string, string> = { EUR: '\u20ac', USD: '$', CHF: 'CHF' };

/**
 * The same price read a second way, for people who still think in fiat.
 *
 * It carries a "roughly" sign and it is never the figure charged. The satoshi
 * amount is rounded and pinned to a rate that only moves a few times a day, so
 * the two agree closely and not exactly, and pretending otherwise would be the
 * one dishonest thing this line could do. The day fiat payment exists, this
 * stops being a landmark and becomes a price the buyer can choose.
 */
function formatAnchor(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const major = minor / 100;
  const amount = minor % 100 === 0 ? String(major) : major.toFixed(2);
  return `\u2248 ${amount} ${symbol}`;
}

/**
 * Buying a plan, and then waiting for it.
 *
 * The waiting half is not a detail. A Bitcoin payment does not settle when the
 * buyer closes the payment page: the plan appears only once BTCPay's signed
 * webhook reaches the server, which can be minutes later and after the app has
 * been closed. Without a visible pending state, a paid user sees a free
 * account and concludes Alice took the money.
 */
export function PlanCheckout() {
  const account = useAccount();
  const [plan, setPlan] = useState<AlicePaidPlan>('cloud');
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A purchase waiting on the account creation it triggered. */
  const [intent, setIntent] = useState<{ plan: AlicePaidPlan; months: number } | null>(null);

  // The price list. Fetched rather than hardcoded: the satoshi figure follows
  // an exchange rate, and only the server knows which one is pinned.
  const [quotes, setQuotes] = useState<AlicePlanQuotes | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPlanQuotes()
      .then(next => { if (!cancelled) setQuotes(next); })
      .catch(() => {
        // In production a missing price means no price: the buy button goes
        // dead rather than guessing at a rate. Locally the worker serving this
        // route is usually not the one deployed, so a stand-in keeps the
        // screen reviewable. It is a placeholder, not a quote, and it never
        // reaches a build users see.
        if (cancelled || process.env.NODE_ENV === 'production') return;
        setQuotes({
          currency: 'SAT',
          anchor_currency: 'EUR',
          step_sats: 100,
          quoted_at: Date.now(),
          plans: [
            { plan: 'cloud', price_sats: 5_600, price_minor: 500 },
          ],
        });
      });
    return () => { cancelled = true; };
  }, []);

  // Design review for the waiting state, which otherwise requires an unsettled
  // Bitcoin payment to exist. Dev only, and applied after mount so the server
  // and client render the same thing. The settled state is no longer here: it
  // belongs to PaymentConfirmedDialog, and `?checkout-preview=settled` shows
  // that dialog instead.
  const [preview, setPreview] = useState<'pending' | null>(null);
  // A previewed paid plan implies a previewed account, so the buy button must
  // not offer to create one: see billing-preview.ts.
  const [previewSignedIn, setPreviewSignedIn] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (new URLSearchParams(window.location.search).get('checkout-preview') === 'pending') {
      setPreview('pending');
    }
    setPreviewSignedIn(isBillingPreview());
  }, []);

  const previewPending: AlicePendingCheckout = {
    invoice_id: 'preview',
    plan: 'cloud',
    months: 3,
    amount_sats: 16_700,
    started_at: Date.now(),
    previous_expires_at: null,
  };
  const pending = preview === 'pending' ? previewPending : account.pendingCheckout;

  const openCheckout = useCallback(async (
    forPlan: AlicePaidPlan,
    forMonths: number,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const checkout = await account.startCheckout(forPlan, forMonths);
      // A new tab, not a redirect: the app keeps running and keeps polling, so
      // the user comes back to a screen that already knows what happened.
      window.open(checkout.checkout_url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Alice could not start the payment.');
    } finally {
      setBusy(false);
    }
  }, [account]);

  const handleBuy = async () => {
    // An anonymous session can hold a plan, but nothing can recover it: the
    // entitlement is tied to this installation alone. Someone who reinstalls
    // or switches phone would lose a plan they paid for, with no way back. So
    // an identity comes first, and it exists for recovery, not for gatekeeping.
    if (account.status !== 'signed_in') {
      setIntent({ plan, months });
      account.requestSignIn('purchase');
      return;
    }
    await openCheckout(plan, months);
  };

  // Resume the purchase the account was created for, rather than dropping the
  // user back at the start of a choice they already made.
  //
  // Waiting for the dialog to close, and not merely for the session to exist,
  // is the whole point. A verified email signs the session in while the person
  // is still choosing a username and a password, and resuming there threw an
  // invoice on screen in the middle of the form they were filling in. An
  // account is finished when its own screen says so.
  useEffect(() => {
    if (!intent || account.status !== 'signed_in' || account.signInOpen) return;
    const resumed = intent;
    setIntent(null);
    void openCheckout(resumed.plan, resumed.months);
  }, [intent, account.status, account.signInOpen, openCheckout]);

  if (pending) {
    return (
      <section style={sectionStyle}>
        <SectionLabel>WAITING FOR CONFIRMATION</SectionLabel>
        <p className="font-numbers m-0 mt-3" style={{ fontSize: 15, lineHeight: '21px' }}>
          Alice is waiting for your payment of {formatSats(pending.amount_sats)} to
          confirm on the Bitcoin network. This can take a few minutes.
        </p>
        <p className="font-numbers m-0 mt-2" style={{ fontSize: 14, opacity: 0.6 }}>
          You can close Alice. Your plan activates on its own as soon as the
          payment settles, and nothing is lost if you leave this screen.
        </p>
        <button
          type="button"
          className="font-pixel tracking-widest mt-4"
          style={{ ...btnBase, backgroundColor: 'transparent', opacity: 0.7 }}
          onClick={() => void account.dismissPendingCheckout()}
        >
          STOP WAITING
        </button>
        <SectionHint>
          This only hides the notice. It does not cancel the payment, and a
          payment that arrives later is still credited.
        </SectionHint>
      </section>
    );
  }

  const selected = quotes?.plans.find(q => q.plan === plan);
  const anchor = quotes?.anchor_currency ?? 'EUR';
  const total = selected?.price_sats == null ? null : selected.price_sats * months;
  const totalAnchor = selected == null ? null : selected.price_minor * months;
  const needsAccount = account.status !== 'signed_in' && !previewSignedIn;

  return (
    <section style={sectionStyle}>
      <SectionLabel>GET MORE PRIVATE CLOUD</SectionLabel>
      <SectionHint>
        Paid in bitcoin. There is no card on file and no automatic renewal: a
        plan runs out, and you decide whether to buy another.
      </SectionHint>

      <div className="flex flex-col gap-2">
        {PLANS.map(option => {
          const active = option.id === plan;
          const quote = quotes?.plans.find(q => q.plan === option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setPlan(option.id)}
              aria-pressed={active}
              className="text-left"
              style={{
                border: `2px solid ${active ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
                borderRadius: 2,
                backgroundColor: 'transparent',
                cursor: 'pointer',
                padding: 12,
              }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-pixel tracking-widest" style={{ fontSize: 11 }}>
                  {option.name}
                </span>
                <span className="text-right">
                  <span className="font-numbers block" style={{ fontSize: 15 }}>
                    {quote?.price_sats == null
                      ? '...'
                      : `${formatSats(quote.price_sats)} / month`}
                  </span>
                  {quote && (
                    <span
                      className="font-numbers block"
                      style={{ fontSize: 12, opacity: 0.5 }}
                    >
                      {formatAnchor(quote.price_minor, anchor)}
                    </span>
                  )}
                </span>
              </div>
              <p className="font-numbers m-0 mt-1" style={{ fontSize: 13, opacity: 0.6 }}>
                {option.pitch}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <SectionLabel>PAY AHEAD</SectionLabel>
        <SectionHint>
          Prepaid months are added to any time you have left, never instead of it.
        </SectionHint>
        <div className="flex gap-2">
          {MONTH_CHOICES.map(choice => {
            const active = choice === months;
            return (
              <button
                key={choice}
                type="button"
                onClick={() => setMonths(choice)}
                aria-pressed={active}
                className="font-pixel tracking-widest"
                style={{
                  ...btnBase,
                  flex: 1,
                  padding: '8px 6px',
                  backgroundColor: 'transparent',
                  color: 'var(--alice-primary)',
                  borderColor: active ? 'var(--alice-primary)' : 'var(--alice-border)',
                }}
              >
                {choice} {choice === 1 ? 'MONTH' : 'MONTHS'}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, color: '#e06060' }}>
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || total === null}
        onClick={() => void handleBuy()}
        className="font-pixel tracking-widest mt-4 w-full"
        style={{
          ...btnBase,
          backgroundColor: 'var(--alice-primary)',
          color: 'var(--alice-on-primary)',
          borderColor: 'var(--alice-primary)',
          opacity: busy || total === null ? 0.6 : 1,
          cursor: busy || total === null ? 'default' : 'pointer',
        }}
      >
        {busy
          ? 'OPENING...'
          : total === null
            ? 'PRICE UNAVAILABLE'
            : needsAccount
              ? `CREATE ACCOUNT AND PAY ${formatSats(total)}`
              : `PAY ${formatSats(total)}`}
      </button>

      {total !== null && totalAnchor !== null && (
        <p
          className="font-numbers m-0 mt-2 text-center"
          style={{ fontSize: 12, opacity: 0.5 }}
        >
          {formatAnchor(totalAnchor, anchor)}
        </p>
      )}

      {needsAccount && (
        <SectionHint>
          A plan needs an account so it can follow you to another device.
          Without one it would be tied to this installation, and reinstalling
          Alice would lose what you paid for.
        </SectionHint>
      )}
    </section>
  );
}
