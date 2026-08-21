'use client';

import { useEffect, useState } from 'react';
import { APP_URL, PROXY_URL } from '@/lib/site';

/**
 * The price list, quoted the way Alice charges: satoshis first, the euro
 * anchor underneath as a landmark with a "roughly" sign.
 *
 * The satoshi figures are fetched from the same public endpoint the app quotes
 * from, so the site can never show a different price than checkout asks for.
 * While the rate is loading, or if the endpoint is unreachable, the sats show
 * as an ellipsis and the anchor stays: a wrong price is worse than a late one.
 */

type PlanQuote = {
  plan: string;
  price_sats: number | null;
  price_minor: number;
};

const FALLBACK_ANCHOR: Record<'cloud', number> = {
  cloud: 500,
};

function formatSats(sats: number): string {
  return `${sats.toLocaleString('en-US')} sats`;
}

function formatAnchor(minor: number): string {
  const major = minor / 100;
  return `≈ ${minor % 100 === 0 ? major : major.toFixed(2)} €`;
}

function PriceLine({ quote, plan }: { quote: PlanQuote | null; plan: 'cloud' }) {
  return (
    <div>
      <div className="text-3xl font-semibold text-[var(--alice-heading)]">
        {quote?.price_sats != null ? formatSats(quote.price_sats) : '...'}
        <span className="ml-2 text-base font-normal text-[var(--alice-muted)]">/ month</span>
      </div>
      <div className="mt-1 text-sm text-[var(--alice-muted)]">
        {formatAnchor(quote?.price_minor ?? FALLBACK_ANCHOR[plan])}
      </div>
    </div>
  );
}

export function PricingPlans() {
  const [quotes, setQuotes] = useState<PlanQuote[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${PROXY_URL}/billing/plans`)
      .then(response => response.ok ? response.json() : null)
      .then((body: { plans?: PlanQuote[] } | null) => {
        if (!cancelled && body?.plans) setQuotes(body.plans);
      })
      .catch(() => { /* the anchor still renders; sats stay an ellipsis */ });
    return () => { cancelled = true; };
  }, []);

  const quoteFor = (plan: 'cloud') =>
    quotes?.find(quote => quote.plan === plan) ?? null;

  const cardClass =
    'flex flex-col gap-5 rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-8';

  // Two cards since Cloud+ was withdrawn. Three columns would leave a gap
  // that reads as a plan still loading.
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Free: the AI you already have, not a trial of the paid one. */}
      <div className={cardClass}>
        <div>
          <h3 className="font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)]">
            Free
          </h3>
          <div className="mt-4 text-3xl font-semibold text-[var(--alice-heading)]">
            0<span className="ml-2 text-base font-normal text-[var(--alice-muted)]">forever</span>
          </div>
        </div>
        <ul className="flex flex-col gap-3 text-[15px] leading-relaxed text-[var(--alice-text)]">
          <li>Alice Local on your device, unlimited</li>
          <li>21 Private Cloud requests to try the larger model</li>
          <li>Your conversations stay on your device, encrypted</li>
        </ul>
        <p className="mt-auto text-sm text-[var(--alice-muted)]">
          Local answers never expire and are never counted. The plan beside this
          one buys cloud capacity, nothing else.
        </p>
      </div>

      {/* Cloud */}
      <div className={cardClass}>
        <div>
          <h3 className="font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)]">
            Cloud
          </h3>
          <div className="mt-4">
            <PriceLine quote={quoteFor('cloud')} plan="cloud" />
          </div>
        </div>
        <ul className="flex flex-col gap-3 text-[15px] leading-relaxed text-[var(--alice-text)]">
          <li>8M input and 2M output tokens of Private Cloud each month</li>
          <li>End-to-end encrypted to confidential hardware</li>
          <li>Never used for training</li>
          <li>Everything in Free, always</li>
        </ul>
        <p className="mt-auto text-sm text-[var(--alice-muted)]">
          Paid in bitcoin. No card on file, no automatic renewal: a plan runs
          out, and you decide whether to buy another.
        </p>
      </div>

      <div className="lg:col-span-2">
        <a
          href={`${APP_URL}/?settings=account`}
          className="cta px-6 py-3 text-[15px]"
        >
          Get more Private Cloud
        </a>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[var(--alice-muted)]">
          Prices are quoted in satoshis, pinned to an exchange rate that moves a
          few times a day at most, so what you see here is what the invoice asks
          for. Usage on paid plans is estimated from the volume of encrypted
          data: your messages are end-to-end encrypted, so Alice cannot count
          tokens exactly, and says so instead of pretending otherwise.
        </p>
      </div>
    </div>
  );
}
