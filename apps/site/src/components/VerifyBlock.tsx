// "Don't trust, verify", a terminal-styled checklist where every claim links
// to its proof. On-brand with the pixel/terminal aesthetic. "Open source" has no
// link yet: the repo goes public with the release, so it reads "soon" rather
// than making a claim we can't back.

type Claim = { claim: string; href: string | null; proof: string };

const CLAIMS: Claim[] = [
  { claim: 'Private Cloud is encrypted end-to-end to attested hardware', href: '/trust/', proof: 'what’s verified' },
  { claim: 'Self-custody, your keys never leave your device', href: '/#sovereignty', proof: 'how it works' },
  { claim: 'No tracking. No cookies.', href: '/privacy/', proof: 'privacy' },
  { claim: 'Honest about what’s verified, and what isn’t', href: '/trust/#status', proof: 'status' },
  { claim: 'Open source', href: null, proof: 'with the public release' },
];

export function VerifyBlock() {
  return (
    <section id="verify" className="mx-auto max-w-4xl px-5 py-16">
      <h2 className="text-3xl font-semibold sm:text-4xl">Don’t trust. Verify.</h2>
      <p className="mt-3 text-lg text-[var(--alice-muted)]">
        Every claim links to its proof, not a marketing promise.
      </p>

      <div className="mt-8 overflow-hidden rounded-[6px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg-soft)]">
        <div className="flex items-center gap-2 border-b border-[var(--alice-border)] px-4 py-2.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
          <span className="ml-2 font-pixel text-[9px] uppercase tracking-widest text-[var(--alice-muted)]">
            verify.alice
          </span>
        </div>
        <ul className="divide-y divide-[var(--alice-border)] font-mono">
          {CLAIMS.map((c) => (
            <li key={c.claim} className="flex items-center gap-3 px-4 py-3.5">
              <span aria-hidden className="text-[var(--alice-primary)]">✓</span>
              <span className="flex-1 text-[14px] text-[var(--alice-heading)]">{c.claim}</span>
              {c.href ? (
                <a
                  href={c.href}
                  className="shrink-0 text-[13px] text-[var(--alice-primary)] hover:underline"
                >
                  {c.proof} →
                </a>
              ) : (
                <span className="shrink-0 text-[13px] text-[var(--alice-muted)]">{c.proof}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
