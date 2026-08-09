'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LaptopIcon, CloudIcon, KeyIcon } from '@/components/icons';

// Pinned scrollytelling. The left panel stays fixed while three steps scroll
// past; the matching row lights up as each step reaches the centre of the
// viewport. The panel makes the model explicit: how Alice runs is a *choice*
// between Local and Private Cloud (either/or, both in the app), while Bitcoin
// self-custody is a constant underneath both. With JS off, all steps are simply
// readable in order and the first row stays highlighted.

type Layer = { label: string; icon: ReactNode };

const LAYERS: Layer[] = [
  { label: 'Local, on your device', icon: <LaptopIcon size={20} /> },
  { label: 'Private Cloud, encrypted', icon: <CloudIcon size={20} /> },
  { label: 'Self-custody, your keys', icon: <KeyIcon size={20} /> },
];

const STEPS: { eyebrow: string; title: string; body: string }[] = [
  {
    eyebrow: 'Option 1 · On your device',
    title: 'Local, nothing leaves your machine',
    body: 'Run Alice entirely on your own device. Your questions are answered on-device and never sent anywhere, the most private way to think out loud about your money.',
  },
  {
    eyebrow: 'Option 2 · When you need power',
    title: 'Private Cloud, encrypted end-to-end',
    body: 'Or reach for a bigger model in the cloud, with your messages encrypted end-to-end to confidential hardware (a TEE), not logged, not sold, not training data. Both modes live in the app: you choose, and switch whenever you want.',
  },
  {
    eyebrow: 'Whichever you pick',
    title: 'Bitcoin sovereignty, your keys, your coins',
    body: 'However Alice runs, your Bitcoin stays self-custody: you hold the keys and Alice never can. Your money and your on-chain privacy stay yours, no one in the middle.',
  },
];

function LayerRow({ layer, on }: { layer: Layer; on: boolean }) {
  return (
    <div
      aria-current={on}
      className={`flex items-center gap-3 rounded-[4px] border-2 px-4 py-3.5 transition-all duration-300 ${
        on
          ? 'border-[var(--alice-primary)] bg-[color-mix(in_srgb,var(--alice-primary)_14%,transparent)] text-[var(--alice-heading)]'
          : 'border-[var(--alice-border)] text-[var(--alice-muted)] opacity-60'
      }`}
    >
      <span className={on ? 'text-[var(--alice-primary)]' : ''}>{layer.icon}</span>
      <span className="text-sm font-semibold">{layer.label}</span>
    </div>
  );
}

export function SovereigntyScroll() {
  const [active, setActive] = useState(0);
  const stepsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = stepsRef.current?.querySelectorAll<HTMLElement>('[data-step]');
    if (!els || els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute('data-step'));
            if (!Number.isNaN(idx)) setActive(idx);
          }
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="sovereignty" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16">
      <h2 className="sr-only">
        How Alice runs, Local or Private Cloud, and how your Bitcoin stays self-custody
      </h2>
      <div className="grid gap-8 md:grid-cols-2">
        {/* Pinned visual. Pinning is desktop-only, on mobile it sits as a static
            block above the steps so nothing overlaps. */}
        <div className="self-start md:sticky md:top-24">
          <div className="rounded-[6px] border-2 border-[var(--alice-border)] bg-[var(--alice-card-bg)] p-6">
            <p className="font-pixel text-[9px] uppercase tracking-widest text-[var(--alice-primary)]">
              How Alice runs, you choose
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <LayerRow layer={LAYERS[0]} on={active === 0} />
              <div className="flex items-center gap-3 py-0.5" aria-hidden>
                <span className="h-px flex-1 bg-[var(--alice-border)]" />
                <span className="font-pixel text-[9px] uppercase tracking-widest text-[var(--alice-muted)]">
                  or
                </span>
                <span className="h-px flex-1 bg-[var(--alice-border)]" />
              </div>
              <LayerRow layer={LAYERS[1]} on={active === 1} />
            </div>

            <p className="mt-6 font-pixel text-[9px] uppercase tracking-widest text-[var(--alice-primary)]">
              Your Bitcoin, always
            </p>
            <div className="mt-4">
              <LayerRow layer={LAYERS[2]} on={active === 2} />
            </div>
          </div>
        </div>

        {/* Scrolling steps */}
        <div ref={stepsRef}>
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              data-step={i}
              className="flex flex-col justify-center py-6 md:min-h-[68vh]"
            >
              <p className="font-pixel text-[9px] uppercase tracking-widest text-[var(--alice-primary)]">
                {step.eyebrow}
              </p>
              <h3 className="mt-3 text-2xl font-semibold sm:text-3xl">{step.title}</h3>
              <p className="mt-3 text-lg leading-relaxed text-[var(--alice-text)]">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
