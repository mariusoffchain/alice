// Home FAQ. Answers the common objections and feeds a FAQPage schema, which
// helps AI answer engines (Google AI Overviews, ChatGPT, Perplexity) cite Alice.

const FAQS: { q: string; a: string; link?: { label: string; href: string } }[] = [
  {
    q: 'Is Alice really private?',
    a: 'Yes. Run Alice fully Local and nothing leaves your device. Or use Private Cloud, where your messages are encrypted end-to-end to confidential hardware, not logged, not training data. You can check exactly how on the trust page.',
  },
  {
    q: 'Can Alice spend or move my Bitcoin?',
    a: 'No. Alice is self-custodial: your keys stay on your device and the AI never holds them. The AI and the wallet are separate code, by construction: inside the app, the Playground is its own wallet with nothing shared with the model, and Alice Wallet on mobile keeps that same separation for your real Bitcoin. The wallet, not the model, validates and signs, so a prompt can never move your funds.',
  },
  {
    q: 'Do you track me?',
    a: 'No. No cookies, no ad trackers, no fingerprinting, no selling data. Private Cloud messages are end-to-end encrypted, so we cannot read them or count tokens exactly: we only see the volume of encrypted bytes passing through, which is how usage is estimated. At most, cookieless aggregate page-view counts elsewhere, nothing that identifies you.',
  },
  {
    q: 'Is it free?',
    a: 'Yes, the app is free and self-custodial, and Alice Local answers without limits. A plan buys exactly one thing: capacity on the larger Private Cloud model hosted in the cloud, nothing else. Alice is in public beta today.',
  },
  {
    q: 'Is Alice on mainnet?',
    a: 'Real funds are only possible today in Alice Wallet on mobile, through the Arkade protocol, and it is still in beta: keep amounts small while it is validated. The Playground inside Alice App only ever uses Mutinynet test coins, nothing there is real money. Private Cloud’s own end-to-end verification is also still being completed, and the trust page says exactly what is proven today.',
  },
  {
    q: 'What is Mutinynet?',
    a: 'A Bitcoin test network, run independently of Alice. Alice also ships a Mutinynet build with test coins, so you can practice sending and receiving safely before touching real sats.',
    link: { label: 'mutinynet.com', href: 'https://mutinynet.com' },
  },
  {
    q: 'Is Alice open source?',
    a: 'Yes. The source, release tags, Android APK checksums, and security model are public, so anyone can inspect the code and verify the distributed beta.',
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <h2 className="text-3xl font-semibold sm:text-4xl">Questions people ask</h2>
      <dl className="mt-8 divide-y divide-[var(--alice-border)]">
        {FAQS.map((f) => (
          <div key={f.q} className="py-5">
            <dt className="text-lg font-semibold text-[var(--alice-heading)]">{f.q}</dt>
            <dd className="mt-2 leading-relaxed text-[var(--alice-text)]">
              {f.a}
              {f.link && (
                <>
                  {' '}
                  <a
                    href={f.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--alice-primary)] hover:underline"
                  >
                    {f.link.label} →
                  </a>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
