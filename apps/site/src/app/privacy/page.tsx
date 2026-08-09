import type { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'How Alice protects you: questions encrypted end-to-end, keys that never leave your device, no email stored in clear, no durable IP record, and a site with no cookies or trackers.',
  alternates: { canonical: '/privacy/' },
};

// The product promises come first: a visitor lands here to know what Alice
// does with their data in the app, not what the brochure site logs.
const inApp = [
  {
    title: 'Your questions',
    detail:
      'Encrypted on your device before they leave, readable only inside the confidential hardware that answers them. Or run Alice fully Local and nothing leaves at all. No one in between, including us, can read them.',
  },
  {
    title: 'Your keys',
    detail:
      'Generated on your device, stored on your device. No server of ours ever sees a recovery phrase or a private key, and the AI has no path to them by construction.',
  },
  {
    title: 'Your email',
    detail:
      'An account is optional, and when you create one we never store your address in clear: only a one-way fingerprint used to sign you in, plus a masked label like ma****@domain.com.',
  },
  {
    title: 'Your IP address',
    detail:
      'Hashed with a key that changes every day, used only for rate limiting, then unrecoverable. There is no durable IP record anywhere.',
  },
  {
    title: 'What Alice remembers about you',
    detail:
      'The memory that personalizes her answers stays on your device, encrypted in the mobile and desktop apps. “What Alice knows” lets you inspect and erase it anytime. It is never sent to us.',
  },
  {
    title: 'Product analytics',
    detail:
      'Day-level aggregate counters only: an event, a platform, a version. No user id, no session id, no timeline. An individual profile cannot be reconstructed from what we store, even in principle.',
  },
];

const wedont = [
  'No cookies, none, not even “functional” ones.',
  'No ad trackers, pixels, or fingerprinting.',
  'No selling or sharing of personal data.',
  'No account, email, or login needed to browse.',
  'No cross-site tracking or third-party profiles.',
];

export default function PrivacyPage() {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-16">
        <p className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-primary)]">
          Privacy
        </p>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.12] sm:text-5xl">
          Alice doesn’t track you.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-[var(--alice-text)]">
          Not in the app, and not on this site. Here is what that means
          concretely, and every claim below links back to{' '}
          <a href="/trust/" className="text-[var(--alice-primary)] hover:underline">
            how we verify it
          </a>
          .
        </p>

        <h2 className="mt-12 text-2xl font-semibold sm:text-3xl">
          How Alice protects you in the app
        </h2>
        <dl className="mt-6 divide-y divide-[var(--alice-border)]">
          {inApp.map((item) => (
            <div key={item.title} className="py-5">
              <dt className="text-lg font-semibold text-[var(--alice-heading)]">{item.title}</dt>
              <dd className="mt-2 leading-relaxed text-[var(--alice-text)]">{item.detail}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-12 text-2xl font-semibold sm:text-3xl">What this site does not do</h2>
        <ul className="mt-4 flex flex-col gap-2 leading-relaxed text-[var(--alice-text)]">
          {wedont.map((w) => (
            <li key={w} className="flex gap-3">
              <span aria-hidden className="text-[var(--alice-primary)]">✓</span>
              {w}
            </li>
          ))}
        </ul>

        <h2 className="mt-12 text-2xl font-semibold sm:text-3xl">The one thing we count</h2>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">
          To know whether anyone is reading, we use cookieless, privacy-first analytics
          (such as Plausible) for aggregate page-view counts only, no cookies, no
          personal data, no cross-site tracking, and nothing that identifies you. That’s
          the whole extent of it.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
