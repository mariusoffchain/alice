import type { Metadata } from 'next';
import { SiteNav } from '@/components/SiteNav';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Trust & verification',
  description:
    'How Alice keeps your Private Cloud chats end-to-end encrypted, the flow, what each party can see, the fail-closed policy, and an honest status of what is verified and what is not yet.',
  alternates: { canonical: '/trust/' },
};

const parties: [string, string][] = [
  [
    'Leaves your device',
    'The model id, ordinary network metadata (IP, timing, sizes), and your prompts and replies, only as ciphertext.',
  ],
  [
    'Alice’s proxy (Cloudflare)',
    'Ciphertext, the model id, sizes and timing, and the Venice key it attaches. It cannot decrypt, it holds no key of yours, and never logs message bodies.',
  ],
  ['Venice, outside the enclave', 'Ciphertext and metadata, never your plaintext.'],
  ['Phala / PCCS', 'Only the public attestation collateral (certificates, TCB info). No prompt, no reply.'],
  [
    'The enclave (Intel TDX)',
    'The plaintext, the one place decryption happens. Attestation is our evidence about what runs there.',
  ],
];

const refusals = [
  'missing attestation',
  'DCAP unavailable',
  'PCCS unavailable',
  'refused TCB status',
  'wrong or replayed nonce',
  'key not bound',
  'debug enabled',
  'unknown measurement',
  'GPU attestation required but unverified',
  'decryption or authentication failure',
  'unexpected plaintext chunk',
];

const statusRows: [string, string][] = [
  ['Encryption (AES-256-GCM · ECDH · HKDF)', 'Implemented + verified, round-trips against production'],
  ['Streaming decrypt, fail-closed, no plaintext shown', 'Implemented + verified'],
  ['Fresh nonce per send · anti-replay', 'Implemented + verified'],
  ['DCAP quote verification (signature + TCB)', 'Implemented, a live attestation returned “UpToDate”'],
  ['Strict TCB policy + debug-mode rejection', 'Implemented + verified'],
  ['Key ↔ attestation binding', 'Implemented + verified; deployed version awaits Venice confirmation'],
  ['Measurement pinning mechanism', 'Implemented + verified'],
  ['Measurement reference values', 'Externally blocked, needs Venice / dstack governance data'],
  ['NVIDIA GPU attestation', 'Pending, not implemented; fails closed when required'],
  ['Mobile (Android / iOS) runtime', 'Export passes; real-device runs still required'],
];

function H({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-24 text-2xl font-semibold sm:text-3xl">
      {children}
    </h2>
  );
}

export default function TrustPage() {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-16">
        <p className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-primary)]">
          Trust
        </p>
        <h1 className="mt-5 text-4xl font-semibold leading-[1.12] sm:text-5xl">
          Don’t trust. Verify.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-[var(--alice-text)]">
          Alice’s Private Cloud encrypts your messages on your device and only decrypts
          them inside confidential hardware that the app tries to verify. Here’s exactly
          what happens, what each party can see, and, honestly, what’s proven today and
          what isn’t yet.
        </p>

        <div className="mt-6 rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-4 text-sm text-[var(--alice-muted)]">
          Today the reachable assurance level is <strong className="text-[var(--alice-heading)]">attested-unpinned</strong>.
          We deliberately do <strong className="text-[var(--alice-heading)]">not</strong> display “E2EE verified”, see the{' '}
          <a href="#status" className="text-[var(--alice-primary)] hover:underline">status</a> below for why.
        </div>

        <H>What “private” means</H>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">
          Your message is encrypted on your device before it leaves. It travels as
          ciphertext through Alice’s proxy and Venice’s infrastructure, and is only
          decrypted inside a hardware enclave (Intel TDX) that Alice tries to verify. The
          reply comes back encrypted and is decrypted on your device. Prefer nothing to
          leave at all? Run Alice fully <strong className="text-[var(--alice-heading)]">Local</strong>.
        </p>

        <H>What each party can see</H>
        <div className="mt-4 overflow-x-auto rounded-[4px] border border-[var(--alice-border)]">
          <table className="w-full text-left text-[15px]">
            <tbody>
              {parties.map(([who, what]) => (
                <tr key={who} className="border-b border-[var(--alice-border)] align-top last:border-0">
                  <th scope="row" className="w-1/3 p-4 font-semibold text-[var(--alice-heading)]">{who}</th>
                  <td className="p-4 text-[var(--alice-text)]">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H>Fail-closed, no silent fallback</H>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">
          For Private Cloud, every one of these is a refusal, never a fallback to a
          non-encrypted model:
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {refusals.map((r) => (
            <span key={r} className="rounded-full border border-[var(--alice-border)] bg-[var(--alice-bg-soft)] px-3 py-1.5 text-[13px] text-[var(--alice-text)]">
              {r}
            </span>
          ))}
        </div>
        <p className="mt-4 leading-relaxed text-[var(--alice-muted)]">
          You see a clear message, “Private Cloud verification failed. No message was
          sent.” Local and Custom AI keep working.
        </p>

        <H id="status">Status, what’s verified, what isn’t</H>
        <p className="mt-3 leading-relaxed text-[var(--alice-text)]">
          We won’t claim more than we can prove. This is the honest state today.
        </p>
        <div className="mt-4 overflow-x-auto rounded-[4px] border border-[var(--alice-border)]">
          <table className="w-full text-left text-[15px]">
            <tbody>
              {statusRows.map(([item, state]) => (
                <tr key={item} className="border-b border-[var(--alice-border)] align-top last:border-0">
                  <th scope="row" className="w-1/2 p-4 font-semibold text-[var(--alice-heading)]">{item}</th>
                  <td className="p-4 text-[var(--alice-text)]">{state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 leading-relaxed text-[var(--alice-muted)]">
          Not ready to display “E2EE verified”: measurement pinning isn’t active (no
          reference values yet) and GPU attestation is unimplemented, so the reachable
          assurance is <strong className="text-[var(--alice-heading)]">attested-unpinned</strong>.
        </p>

        <H>Limits and remaining assumptions</H>
        <ul className="mt-3 flex flex-col gap-2 leading-relaxed text-[var(--alice-text)]">
          <li>Measurement reference values aren’t available yet, so pinning isn’t active.</li>
          <li>NVIDIA GPU attestation is not verified.</li>
          <li>DCAP verification reduces, but doesn’t remove, trust in Phala’s availability and Intel’s / NVIDIA’s roots.</li>
          <li>Assistant history is dropped in Private (single-shot turns), since Venice doesn’t encrypt assistant replies.</li>
          <li>Mobile (Android / iOS) enclave verification isn’t runtime-tested yet.</li>
        </ul>

        <p className="mt-12 text-sm text-[var(--alice-muted)]">
          The full trust model and the source code will be published with the public
          release, so anyone can check these claims independently.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
