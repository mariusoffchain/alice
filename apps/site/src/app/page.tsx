import {
  ANDROID_APK_URL,
  ANDROID_RELEASE_URL,
  ANDROID_VERSION,
  BETA_NOTICE,
  HERO_TITLE,
  SITE_URL,
} from '@/lib/site';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';
import { AppCtas, ReleaseLinks } from '@/components/AppCtas';
import { SovereigntyScroll } from '@/components/SovereigntyScroll';
import { Missions } from '@/components/Missions';
import { VerifyBlock } from '@/components/VerifyBlock';
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
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-14 sm:pt-24 sm:pb-20">
          <p className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-primary)]">
            Private AI · Bitcoin · Self-custody
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.1] sm:text-6xl">
            {HERO_TITLE}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--alice-text)] sm:text-xl">
            Alice explains Bitcoin in plain words, helps you set up self-custody,
            and keeps your questions private end-to-end. She guides,{' '}
            <span className="text-[var(--alice-heading)]">she never touches your keys.</span>
          </p>
          {/* App entries, the device-appropriate one is filled. Beta status
              stays right underneath, small but honest. */}
          <div className="mt-8">
            <AppCtas size="md" />
            <ReleaseLinks />
            <p className="mt-3 text-sm text-[var(--alice-muted)]">{BETA_NOTICE}</p>
          </div>
        </section>

        {/* Sovereignty, pinned scrollytelling, right under the hero (Local or
            Private Cloud is a choice; Bitcoin self-custody is a constant) */}
        <SovereigntyScroll />

        {/* Alice's mission, slogan + mission tiles + who it's for */}
        <Missions />

        {/* Don't trust, verify, proof links */}
        <VerifyBlock />

        {/* FAQ (with FAQPage schema) */}
        <Faq />

        {/* vs ChatGPT teaser */}
        <section className="mx-auto max-w-6xl px-5 pb-20">
          <div className="flex flex-col items-start gap-5 rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold">You already ask AI about Bitcoin.</h2>
              <p className="mt-2 text-[var(--alice-muted)]">
                Here’s honestly how Alice compares to ChatGPT, where she wins, and
                where she doesn’t.
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
