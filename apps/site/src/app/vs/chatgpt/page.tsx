import type { Metadata } from 'next';
import { APP_URL, OG_ALT, SITE_URL } from '@/lib/site';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Alice vs ChatGPT for Bitcoin',
  description:
    'A private AI companion for Bitcoin vs a general assistant. How Alice compares to ChatGPT on privacy, safety, self-custody, and Bitcoin depth, including where ChatGPT is still better.',
  alternates: { canonical: '/vs/chatgpt/' },
  openGraph: {
    title: 'Alice vs ChatGPT for Bitcoin',
    description:
      'How a private, Bitcoin-specialized AI companion compares to a general assistant, honestly, including where ChatGPT wins.',
    url: `${SITE_URL}/vs/chatgpt/`,
    type: 'article',
    // Declaring openGraph here replaces the root one wholesale, so the shared
    // card from app/opengraph-image.png has to be named again or this page
    // ships with no preview image at all.
    images: [{ url: '/opengraph-image.png', width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Alice vs ChatGPT for Bitcoin',
    description:
      'How a private, Bitcoin-specialized AI companion compares to a general assistant, honestly, including where ChatGPT wins.',
    images: [{ url: '/opengraph-image.png', alt: OG_ALT }],
  },
};

const rows: { dimension: string; alice: string; chatgpt: string }[] = [
  {
    dimension: 'Privacy of your questions',
    alice: 'Private Cloud chats encrypted end-to-end to confidential hardware, never used for training. What Alice remembers to personalize her answers is kept on your device, encrypted in the apps, and you can erase it anytime.',
    chatgpt: 'Conversations may be retained and, depending on settings, used to improve models.',
  },
  {
    dimension: 'Can it move your money?',
    alice: 'No. Alice has no spending authority today, the wallet, not the AI, holds keys and signs. A separate wallet for Alice to make agentic payments on your behalf is planned, not available yet.',
    chatgpt: 'No wallet of its own, but plugins/agents wired to one can be given real spending power.',
  },
  {
    dimension: 'Bitcoin focus',
    alice: 'Purpose-built for Bitcoin, self-custody, and privacy, with the wallet in the same place.',
    chatgpt: 'General-purpose; strong broad knowledge, not specialized or connected to your wallet.',
  },
  {
    dimension: 'Honest about limits',
    alice: 'Clearly educational, not financial advice; beta status stated up front.',
    chatgpt: 'General disclaimers; not tailored to Bitcoin risk.',
  },
];

const faqs: { q: string; a: string }[] = [
  {
    q: 'Is Alice more private than ChatGPT for Bitcoin questions?',
    a: 'For its Private Cloud mode, Alice encrypts your messages end-to-end to a confidential hardware (TEE) enclave and does not use them as training data. General assistants like ChatGPT may retain conversations and use them to improve their models depending on your settings.',
  },
  {
    q: 'Can Alice spend or move my Bitcoin?',
    a: 'No. Alice is designed so the AI never has spending authority. The wallet code, not the AI model, holds your keys and signs transactions, so a prompt can never move your funds. A separate wallet giving Alice agentic payment ability is planned for later, not available today.',
  },
  {
    q: 'Where is ChatGPT still better than Alice?',
    a: 'ChatGPT is a mature, general-purpose assistant with broader world knowledge and a long track record. Alice is a focused product in public beta, narrower on purpose, but encrypted end-to-end in the cloud and fully offline when run Local, both further than ChatGPT goes.',
  },
  {
    q: 'Do I need to trust Alice with my coins to try her?',
    a: 'No. You can try Alice without any coins at all: the companion answers your questions on its own. And when you do use the wallet, it is self-custodial. Your keys are generated on your device, stay on your device, and Alice can never touch them.',
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

export default function VsChatGptPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <SiteNav />
      <main id="main" className="mx-auto max-w-4xl px-5 py-16">
        <p className="font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)]">
          Comparison
        </p>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.12] sm:text-5xl">
          Alice vs ChatGPT for Bitcoin
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--alice-text)]">
          Most people already ask ChatGPT about Bitcoin. The difference with
          Alice is simple: your questions stay private. They are encrypted so
          that no one, not even us, can read them, and they are answered by a
          companion built only for Bitcoin. Here’s the honest comparison,
          including where ChatGPT still wins.
        </p>

        {/* Comparison table */}
        <div className="mt-10 overflow-x-auto rounded-[4px] border border-[var(--alice-border)]">
          <table className="w-full border-collapse text-left text-[15px]">
            <caption className="sr-only">Alice compared with ChatGPT for Bitcoin</caption>
            <thead>
              <tr className="bg-[var(--alice-bg-soft)]">
                <th scope="col" className="p-4 font-semibold text-[var(--alice-muted)]">
                  &nbsp;
                </th>
                <th scope="col" className="p-4 font-semibold text-[var(--alice-primary)]">
                  Alice
                </th>
                <th scope="col" className="p-4 font-semibold text-[var(--alice-heading)]">
                  ChatGPT
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dimension} className="border-t border-[var(--alice-border)] align-top">
                  <th scope="row" className="p-4 font-semibold text-[var(--alice-heading)]">
                    {r.dimension}
                  </th>
                  <td className="p-4 text-[var(--alice-text)]">{r.alice}</td>
                  <td className="p-4 text-[var(--alice-muted)]">{r.chatgpt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Where ChatGPT wins, credibility */}
        <section className="mt-12 rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-7">
          <h2 className="text-2xl font-semibold">Where ChatGPT is still better</h2>
          <p className="mt-3 leading-relaxed text-[var(--alice-text)]">
            We’re not going to pretend otherwise. ChatGPT is a mature, general-purpose
            assistant with far broader knowledge and years of refinement. Alice is a
            focused product in public beta: narrower on purpose, but encrypted
            end-to-end in the cloud and fully offline when run Local, both further
            than ChatGPT goes. If you want a do-everything assistant, ChatGPT
            wins. If you want a private, Bitcoin-specialized companion that can’t
            touch your funds, that’s Alice.
          </p>
        </section>

        {/* FAQ */}
        <section className="mt-12">
          <h2 className="text-2xl font-semibold">Questions people ask</h2>
          <dl className="mt-6 divide-y divide-[var(--alice-border)]">
            {faqs.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="text-lg font-semibold text-[var(--alice-heading)]">{f.q}</dt>
                <dd className="mt-2 leading-relaxed text-[var(--alice-text)]">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* CTA */}
        <section className="mt-12 flex flex-col items-start gap-4 rounded-[4px] border-2 border-[var(--alice-primary)] p-7 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Try a private Bitcoin companion</h2>
            <p className="mt-1 text-sm text-[var(--alice-muted)]">Free, self-custodial, and open source.</p>
          </div>
          <a
            href={APP_URL}
            className="shrink-0 rounded-[3px] border-2 border-[var(--alice-primary)] bg-[var(--alice-primary)] px-5 py-3 font-semibold text-[var(--alice-on-primary)] transition-transform hover:-translate-y-0.5"
          >
            Open Alice
          </a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
