import {
  ANDROID_APK_URL,
  ANDROID_RELEASE_URL,
  ANDROID_VERSION,
  SITE_URL,
} from '@/lib/site';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { HeroTour } from '@/components/HeroTour';
import { SovereigntyScroll } from '@/components/SovereigntyScroll';
import { Missions } from '@/components/Missions';
import { Faq } from '@/components/Faq';

// SoftwareApplication schema for the product itself, on the home page.
const appSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Alice',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web, Android',
  url: SITE_URL,
  description:
    'A private AI companion that helps you understand, hold, and use Bitcoin. Self-custody is built in; the AI explains and guides but never holds your keys.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  softwareVersion: ANDROID_VERSION,
  downloadUrl: ANDROID_APK_URL,
  releaseNotes: ANDROID_RELEASE_URL,
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }}
      />
      <SiteNav />
      <main id="main">
        {/* Hero, proofs, and the app tour as one continuous object: on
            desktop the right column is a single pinned Alice screen that
            starts as a working ask interface and becomes the tour captures. */}
        <HeroTour />

        {/* Sovereignty, pinned scrollytelling (Local or Private Cloud is a
            choice; Bitcoin self-custody is a constant) */}
        <SovereigntyScroll />

        {/* Alice's mission, slogan + mission tiles + who it's for */}
        <Missions />

        {/* FAQ (with FAQPage schema) */}
        <Faq />

        {/* vs ChatGPT teaser */}
        <section className="mx-auto max-w-6xl px-5 pb-20">
          <div className="flex flex-col items-start gap-5 rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold">
                The Bitcoin AI that answers you, and forgets to spy on you.
              </h2>
              <p className="mt-2 text-[var(--alice-muted)]">
                You already ask AI about Bitcoin. Here’s honestly how Alice
                compares to ChatGPT, where she wins, and where she doesn’t.
              </p>
            </div>
            <a
              href="/vs/chatgpt/"
              className="shrink-0 rounded-[3px] border-2 border-[var(--alice-primary)] px-5 py-3 font-semibold text-[var(--alice-primary)] transition-colors hover:bg-[var(--alice-primary)] hover:text-[var(--alice-on-primary)]"
            >
              Alice vs ChatGPT →
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
