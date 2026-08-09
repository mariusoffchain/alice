import type { ReactNode } from 'react';
import { BookIcon, CompassIcon, ShieldIcon, ShieldCheckIcon } from '@/components/icons';

// Alice's mission, led by the slogan. Four mission tiles, then a compact
// "who it's for" strip that absorbs the old audience cards.

const MISSIONS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <BookIcon size={24} />,
    title: 'Educate',
    body: 'Bitcoin in plain words, at your pace. No jargon, no pressure to buy.',
  },
  {
    icon: <CompassIcon size={24} />,
    title: 'Guide',
    body: 'Set up self-custody and payments step by step, whenever you get stuck.',
  },
  {
    icon: <ShieldIcon size={24} />,
    title: 'Harden',
    body: 'Tighten your security and on-chain privacy with practical, honest OPSEC.',
  },
  {
    icon: <ShieldCheckIcon size={24} />,
    title: 'Verify locally',
    body: 'The wallet validates on your device; Alice only advises, she never signs.',
  },
];

export function Missions() {
  return (
    <section id="missions" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      {/* Slogan manifesto */}
      <div className="max-w-3xl">
        <p className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-primary)]">
          Alice’s mission
        </p>
        <h2 className="mt-4 text-4xl font-semibold leading-[1.08] sm:text-5xl">
          Hold your keys.
          <br />
          Hold your chats.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-[var(--alice-heading)]">
          Not a wallet with a chatbot bolted on. Alice is a companion first.
        </p>
        <p className="mt-3 text-lg leading-relaxed text-[var(--alice-muted)]">
          Uncensorable and private like Bitcoin itself, private by design, never able
          to touch your keys, and Bitcoin-native to the core. She teaches, guides, and
          helps you tighten your security, while the wallet checks everything on your
          device. Need more power? Private Cloud is one tap away, still end-to-end
          encrypted.
        </p>
      </div>

      {/* Mission tiles */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {MISSIONS.map((m) => (
          <div
            key={m.title}
            className="rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-6"
          >
            <span className="text-[var(--alice-primary)]">{m.icon}</span>
            <h3 className="mt-4 text-lg font-semibold">{m.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--alice-text)]">{m.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
