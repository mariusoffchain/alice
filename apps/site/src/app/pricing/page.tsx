import type { Metadata } from 'next';
import { OG_ALT, SITE_URL } from '@/lib/site';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { PricingPlans } from '@/components/PricingPlans';

export const metadata: Metadata = {
  title: 'Alice Pricing',
  description:
    'Alice Local is free and unlimited on your device. Private Cloud plans add millions of end-to-end encrypted tokens each month, paid in bitcoin, with no card on file and no automatic renewal.',
  alternates: { canonical: '/pricing/' },
  openGraph: {
    title: 'Alice Pricing',
    description:
      'Free local AI. Private Cloud plans in millions of tokens, paid in bitcoin, no automatic renewal.',
    url: `${SITE_URL}/pricing/`,
    type: 'website',
    // Declaring openGraph here replaces the root one wholesale, so the shared
    // card from app/opengraph-image.png has to be named again or this page
    // ships with no preview image at all.
    images: [{ url: '/opengraph-image.png', width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alice Pricing',
    description:
      'Free local AI. Private Cloud plans in millions of tokens, paid in bitcoin, no automatic renewal.',
    images: [{ url: '/opengraph-image.png', alt: OG_ALT }],
  },
};

const faqs: { q: string; a: string }[] = [
  {
    q: 'Why bitcoin only?',
    a: 'Because it is what Alice is for, and because it means no card on file. Nothing can charge you on its own: a plan runs out and stops, and renewing is a decision you make, never one made for you.',
  },
  {
    q: 'Why are prices in satoshis?',
    a: 'You pay in bitcoin, so you are quoted in bitcoin. The euro figure underneath is the same price read a second way, and the satoshi amount is what the invoice actually asks for. The rate behind it is pinned server-side and moves a few times a day at most, so the price does not tick while you read it.',
  },
  {
    q: 'What happens when a plan expires?',
    a: 'Nothing dramatic. You go back to the free plan. Alice Local keeps answering without limits, and everything Alice remembers for you stays on your device, because none of that was ever behind the paywall. Only the cloud capacity ends.',
  },
  {
    q: 'Can I pay for several months at once?',
    a: 'Yes. Prepaid months are added to whatever time you have left, never instead of it, and Alice can warn you by email before the last one runs out if you give her an address for exactly that.',
  },
  {
    q: 'How is usage counted if my messages are encrypted?',
    a: 'Alice cannot read your messages, so she cannot count tokens exactly. She measures the volume of encrypted data passing through and converts it with a calibrated ratio. Your account shows a percentage estimated that way, and it is labeled as an estimate because that is what it is.',
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(faq => ({
    '@type': 'Question',
    name: faq.q,
    acceptedAnswer: { '@type': 'Answer', text: faq.a },
  })),
};

export default function PricingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <SiteNav />
      <main id="main">
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-10 sm:pt-24">
          <p className="font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)]">
            Pricing
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.1] sm:text-5xl">
            One AI on your device, free. One in the cloud, priced plainly.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--alice-text)]">
            Alice answers on your device for free, without limits, forever. A
            plan buys exactly one thing: capacity on the larger Private Cloud
            model, end-to-end encrypted, for the questions your device cannot
            carry alone.
          </p>
          {/* The site-wide beta notice talks about mainnet and test coins,
              which is wallet territory. This page is about the AI alone, so
              it carries its own one-line status instead. */}
          <p className="mt-4 text-sm text-[var(--alice-muted)]">
            Alice is in public beta. Plans are on sale in the app, paid in bitcoin.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-16">
          <PricingPlans />
        </section>

        {/* The questions a price page creates, answered where they arise. */}
        <section className="mx-auto max-w-6xl px-5 pb-20">
          <h2 className="text-2xl font-semibold text-[var(--alice-heading)]">
            Fair questions
          </h2>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {faqs.map(faq => (
              <div
                key={faq.q}
                className="rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-6"
              >
                <h3 className="text-[16px] font-semibold text-[var(--alice-heading)]">
                  {faq.q}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--alice-text)]">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
