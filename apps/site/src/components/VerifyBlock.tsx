// "Don't trust, verify", a terminal-styled checklist where every claim links
// to its proof. On-brand with the pixel/terminal aesthetic. Every entry must
// point at something a reader can open: a claim whose proof is only promised
// is the one thing this block cannot contain.
import { SOURCE_URL } from '@/lib/site';
import { externalLinkProps } from '@/lib/links';

type Claim = { claim: string; href: string; proof: string };

const CLAIMS: Claim[] = [
  { claim: 'Private Cloud is encrypted end-to-end to attested hardware', href: '/trust/', proof: 'what’s verified' },
  { claim: 'Self-hosted and self-custody, your keys and your data never leave your device', href: '/#sovereignty', proof: 'how it works' },
  { claim: 'No tracking. No cookies.', href: '/privacy/', proof: 'privacy' },
  { claim: 'Honest about what’s verified, and what isn’t', href: '/trust/#status', proof: 'status' },
  { claim: 'Open source, AGPL', href: SOURCE_URL, proof: 'read the code' },
];

// Width-agnostic: the parent decides the column. Today it renders inside the
// hero's left column (HeroTour), right under the claims it backs up.
export function VerifyBlock() {
  return (
    <section id="verify" className="pt-16">
      <h2 className="text-3xl font-semibold">Don’t trust. Verify.</h2>
      <p className="mt-3 text-lg text-[var(--alice-muted)]">
        Every claim links to its proof, not a marketing promise.
      </p>

      <div className="mt-8 overflow-hidden rounded-[6px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg-soft)]">
        <div className="flex items-center gap-2 border-b border-[var(--alice-border)] px-4 py-2.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
          <span className="ml-2 font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-muted)]">
            verify.alice
          </span>
        </div>
        <ul className="divide-y divide-[var(--alice-border)] font-mono">
          {CLAIMS.map((c) => (
            <li key={c.claim} className="flex items-center gap-3 px-4 py-3.5">
              <span aria-hidden className="text-[var(--alice-primary)]">✓</span>
              <span className="flex-1 text-[14px] text-[var(--alice-heading)]">{c.claim}</span>
              <a
                href={c.href}
                // Off-site proofs open in a new tab, and no referrer follows
                // the reader there: a privacy page that leaks where you came
                // from would undercut the claim right above it.
                {...externalLinkProps(c.href)}
                className="shrink-0 text-[13px] text-[var(--alice-primary)] hover:underline"
              >
                {c.proof} →
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
