// Home FAQ. Answers the common objections and feeds a FAQPage schema, which
// helps AI answer engines (Google AI Overviews, ChatGPT, Perplexity) cite Alice.

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Is Alice really private?',
    a: 'Yes. Run Alice fully Local and nothing leaves your device. Or use Private Cloud, where your messages are encrypted end-to-end to confidential hardware, not logged, not training data. You can check exactly how on the trust page.',
  },
  {
    q: 'Can Alice spend or move my Bitcoin?',
    a: 'No. Alice is self-custodial: your keys stay on your device and the AI never holds them. The wallet code, not the model, validates and signs, so a prompt can never move your funds.',
  },
  {
    q: 'Do you track me?',
    a: 'No. No cookies, no ad trackers, no fingerprinting, no selling data. At most, cookieless aggregate page-view counts, nothing that identifies you.',
  },
  {
    q: 'Is it free?',
    a: 'Yes, the app is free and self-custodial. You bring your own keys. Alice is in private beta today.',
  },
  {
    q: 'Is Alice on mainnet?',
    a: 'Yes. Alice is in private beta on Bitcoin mainnet, for small amounts only while the product is validated. Full end-to-end verification of Private Cloud is still pending, and the beta stays closed until it lands.',
  },
  {
    q: 'What is Mutinynet?',
    a: 'A Bitcoin test network. Alice also ships a Mutinynet build with test coins, so you can practice sending and receiving safely before touching real sats.',
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
            <dd className="mt-2 leading-relaxed text-[var(--alice-text)]">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
