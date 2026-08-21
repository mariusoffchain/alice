'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { APP_URL, HERO_TITLE, WALLET_URL, appQuestionUrl } from '@/lib/site';
import { useStepClip } from '@/lib/use-step-clip';
import { AppCtas, ReleaseLinks } from '@/components/AppCtas';
import { VerifyBlock } from '@/components/VerifyBlock';

/**
 * The hero and the app tour as one continuous object. On desktop, the right
 * column holds a single pinned "Alice screen", an app in the page: a reduced
 * sidebar whose entry lights up with the tour, a working welcome screen
 * (type or pick a question, land in the real app with it autosent), and
 * simplified, readable renditions of the explorer, a course, and the test
 * wallet as the steps scroll past. It unpins after the last step. On phones
 * the panel does not exist: the hero stacks, and the full-app captures below
 * pin above the steps instead.
 *
 * The captures (mobile only) live in public/screens/, taken from a fresh
 * headless profile so no personal data can appear in them.
 */

// Every step carries a real phone capture, used on small screens (and for the
// wallet step on every screen, since the wallet only exists on a phone).
// Taken from a fresh headless profile, so no personal data can appear.
const SCREENS: { src: string; alt: string; eyebrow: string; title: string; body: string; appHref: string }[] = [
  {
    src: '/screens/mobile/chat.webp',
    alt: 'The Alice chat screen on a phone, showing a question and Alice’s answer',
    eyebrow: 'Ask Alice',
    title: 'Chat with Alice',
    body: 'The companion at the heart of the app. Ask in plain words, get answers at your level: Alice remembers what you are learning, on your device, and picks the next step with you.',
    appHref: `${APP_URL}/`,
  },
  {
    src: '/screens/mobile/explorer.webp',
    alt: 'The block explorer screen on a phone, with live blocks and famous transactions',
    eyebrow: 'Explorer',
    title: 'See the chain for yourself',
    body: 'Live blocks, fees, famous transactions, notorious addresses. Watch any address or xpub, and ask Alice to explain what you are looking at.',
    appHref: `${APP_URL}/explorer`,
  },
  {
    src: '/screens/mobile/learn.webp',
    alt: 'The Learn screen on a phone, showing the Plan B Academy course catalogue',
    eyebrow: 'Learn',
    title: 'Courses that feed the conversation',
    body: 'The school inside the app: the full Plan B Academy catalogue, from first steps to cryptography. Finish a chapter and Alice knows, so her answers keep up with you.',
    appHref: `${APP_URL}/learn`,
  },
  {
    src: '/screens/mobile/playground.webp',
    alt: 'The Playground screen on a phone, a practice Bitcoin wallet on the Mutinynet test network',
    eyebrow: 'Playground',
    title: 'Practice with coins that cost nothing',
    body: 'A sandbox with real rules. A real Bitcoin wallet on Mutinynet, a test network with free coins: send, receive, back up, and make every mistake here instead of on mainnet.',
    appHref: `${APP_URL}/playground`,
  },
  {
    src: '/screens/mobile/wallet.webp',
    alt: 'Alice Wallet on a phone, its welcome screen offering to create or import a wallet',
    eyebrow: 'Wallet',
    title: 'Get Alice Wallet',
    body: 'When practice becomes real: the everyday wallet, with the same Alice beside you. It runs on your phone only for now, and it is a beta on Bitcoin mainnet, so keep the amounts small while it is validated.',
    appHref: WALLET_URL,
  },
];

// The step whose screen is a phone rather than the desktop app. The wallet has
// no desktop build yet, and showing it in a browser window would say otherwise.
const WALLET_STEP = 4;

function WindowFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[6px] border-2 border-[var(--alice-border)] bg-[var(--alice-card-bg)]">
      <div className="flex items-center gap-2 border-b-2 border-[var(--alice-border)] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--alice-border)]" />
        <span className="ml-2 font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-muted)]">
          {label}
        </span>
      </div>
      <div className="relative aspect-[16/10]">{children}</div>
    </div>
  );
}

// A phone standing in the stage, for screens that only exist on a phone (the
// wallet on desktop) and for the whole tour on small screens.
function PhoneScreen({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-[16px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg)] ${className ?? ''}`}
      style={{ aspectRatio: '390 / 844' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover object-top" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The desktop panel is an app in the page, not a shrunken screenshot: real
// sidebar entries (the app's own icons) that light up with the tour, a
// working welcome screen, and simplified renditions of the other rooms kept
// readable at panel size. Only questions and the input are clickable.
// ---------------------------------------------------------------------------

// The app's own icon set (copied from app-web's Sidebar, {{COLOR}} template
// and all) so the miniature cannot drift from the real thing's shapes.
const ICONS = {
  newChat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect x="1.6" y="1.6" width="12.8" height="12.8" rx="3" fill="{{COLOR}}" fill-opacity="0.45"/><path d="M7.1 4.4h1.8v2.7h2.7v1.8H8.9v2.7H7.1V8.9H4.4V7.1h2.7z" fill="{{COLOR}}"/></svg>`,
  explorer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect x="2" y="2" width="12" height="5" rx="1.5" fill="{{COLOR}}" fill-opacity="0.45"/><rect x="2" y="6.5" width="12" height="7.5" rx="1.5" fill="{{COLOR}}"/></svg>`,
  learn: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect x="2" y="2" width="3" height="10" fill="{{COLOR}}" fill-opacity="0.45"/><rect x="6" y="4" width="3" height="8" fill="{{COLOR}}" fill-opacity="0.45"/><rect x="10" y="3" width="3" height="9" fill="{{COLOR}}" fill-opacity="0.45"/><rect x="1" y="12" width="14" height="2" fill="{{COLOR}}"/></svg>`,
  playground: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><rect x="5" y="2.5" width="6" height="5" rx="1" fill="{{COLOR}}"/><rect x="1.5" y="8.5" width="6" height="5" rx="1" fill="{{COLOR}}" fill-opacity="0.45"/><rect x="8.5" y="8.5" width="6" height="5" rx="1" fill="{{COLOR}}" fill-opacity="0.45"/></svg>`,
};

function MiniIcon({ svg, size, color = 'var(--alice-primary)' }: { svg: string; size: number; color?: string }) {
  const sized = svg
    .replaceAll('{{COLOR}}', color)
    .replace('width="16"', `width="${size}"`)
    .replace('height="16"', `height="${size}"`);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
}

const SIDEBAR_ITEMS = [
  { icon: ICONS.newChat, label: 'New Chat' },
  { icon: ICONS.explorer, label: 'Explorer' },
  { icon: ICONS.learn, label: 'Learn' },
  { icon: ICONS.playground, label: 'Playground' },
];

// Deliberately reduced to the four rooms, nothing else: no logo, no history,
// no account row. This is an app in the page, not a shrunken screenshot, so
// everything kept must stay readable.
function MiniSidebar({ active }: { active: number }) {
  const activeItem = Math.max(active, 0);
  return (
    <div
      className="flex h-full w-[27%] shrink-0 select-none flex-col justify-center border-r border-[var(--alice-border)]"
      style={{ backgroundColor: 'var(--alice-bg-soft)' }}
      aria-hidden
    >
      {SIDEBAR_ITEMS.map((item, i) => (
        <span
          key={item.label}
          className="flex items-center gap-2.5 px-4 py-3 transition-colors duration-300"
          style={{
            color: 'var(--alice-text)',
            backgroundColor: i === activeItem ? 'var(--alice-bg)' : 'transparent',
          }}
        >
          <MiniIcon svg={item.icon} size={15} />
          <span className="whitespace-nowrap text-[13px] leading-none">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

// Shared shell for the three non-interactive panes.
function MiniPane({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 flex flex-col transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0, backgroundColor: 'var(--alice-bg)' }}
      aria-hidden
    >
      {children}
    </div>
  );
}

// The welcome screen, working: same greeting, same four suggestions as the
// app's, and asking really opens the app with the question autosent.
const APP_SUGGESTIONS = [
  'What is Bitcoin?',
  'How do I secure my wallet?',
  'Explain Lightning Network',
  'What is self-custody?',
];

function MiniChat({ visible }: { visible: boolean }) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const go = (question: string) => {
    setSubmitting(true);
    window.location.href = appQuestionUrl(question);
  };

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col transition-opacity duration-300"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        backgroundColor: 'var(--alice-bg)',
      }}
      aria-hidden={!visible}
    >
      <div className="flex flex-1 flex-col justify-center gap-5 px-7">
        <p className="text-[16px] font-semibold text-[var(--alice-heading)]">
          Hi! What would you like to learn about today?
        </p>
        <div className="grid grid-cols-2 gap-3">
          {APP_SUGGESTIONS.map((question) => (
            <button
              key={question}
              type="button"
              disabled={submitting}
              onClick={() => go(question)}
              className="cursor-pointer rounded-[3px] border border-[var(--alice-border)] bg-transparent px-4 py-3.5 text-left text-[13px] text-[var(--alice-text)] transition-colors hover:border-[var(--alice-primary)]"
            >
              {question}
            </button>
          ))}
        </div>
      </div>
      <form
        className="px-7 pb-7"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) go(value.trim());
        }}
      >
        <div className="flex flex-col gap-2.5 rounded-[3px] border border-[var(--alice-border)] px-4 py-3 focus-within:border-[var(--alice-primary)]">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
            placeholder="Ask Alice something..."
            aria-label="Ask Alice a question"
            className="w-full bg-transparent text-[14px] text-[var(--alice-heading)] placeholder:text-[var(--alice-muted)] focus:outline-none"
          />
          <div className="flex items-center justify-end gap-3">
            <span className="text-[11px] font-semibold text-[var(--alice-heading)]">Private</span>
            <span className="text-[11px] text-[var(--alice-muted)]">Medium</span>
            <button
              type="submit"
              disabled={submitting}
              aria-label={submitting ? 'Opening Alice' : 'Ask Alice'}
              className="raise flex h-7 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[3px] bg-[var(--alice-primary)] text-[13px] font-bold text-[var(--alice-on-primary)] disabled:cursor-wait"
            >
              {submitting ? '·' : '↑'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// The explorer, reduced to its two signatures: the live block rail, and a
// transaction drawn as an input/output flow, so the pane reads as a block
// explorer at a glance.
const BLOCK_TILES = [
  { height: 'Next block', fee: '~2 sat/vB', tx: '4,338 tx', pending: true },
  { height: '963,313', fee: '~3 sat/vB', tx: '3,300 tx' },
  { height: '963,312', fee: '~1 sat/vB', tx: '5,029 tx' },
  { height: '963,311', fee: '~1 sat/vB', tx: '5,319 tx' },
];

function MiniExplorer({ visible }: { visible: boolean }) {
  return (
    <MiniPane visible={visible}>
      <div className="px-7 pt-6">
        <p className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-primary)]">
          Live blocks
        </p>
        <div className="mt-3 grid grid-cols-4 gap-2.5">
          {BLOCK_TILES.map((block) => (
            <div
              key={block.height}
              className={`rounded-[3px] border px-3 py-2.5 ${
                block.pending
                  ? 'border-dashed border-[var(--alice-border)]'
                  : 'border-[var(--alice-border)] border-t-[3px] border-t-[#57d38c]'
              }`}
            >
              <p className="font-pixel text-[10px] text-[var(--alice-heading)]">{block.height}</p>
              <p className="mt-1.5 text-[11px] text-[#57d38c]">{block.fee}</p>
              <p className="mt-0.5 text-[11px] text-[var(--alice-muted)]">{block.tx}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center px-7 pb-5">
        <p className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-primary)]">
          Transaction
        </p>
        <svg viewBox="0 0 420 150" className="mt-2 w-full">
          <path d="M0,45 C120,45 130,72 205,72" fill="none" stroke="var(--alice-primary)" strokeOpacity="0.45" strokeWidth="14" />
          <path d="M0,110 C120,110 130,84 205,84" fill="none" stroke="var(--alice-primary)" strokeOpacity="0.45" strokeWidth="9" />
          <path d="M215,70 C290,70 300,32 420,32" fill="none" stroke="var(--alice-primary)" strokeWidth="11" />
          <path d="M215,78 C290,78 300,78 420,78" fill="none" stroke="var(--alice-primary)" strokeWidth="8" />
          <path d="M215,86 C290,86 300,124 420,124" fill="none" stroke="var(--alice-primary)" strokeWidth="5" />
          <rect x="203" y="58" width="12" height="40" rx="2" fill="var(--alice-heading)" />
        </svg>
        <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--alice-muted)]">
          <span>2 inputs · 0.50 BTC</span>
          <span className="font-mono">f4184f...e26b</span>
          <span>3 outputs</span>
        </div>
      </div>
    </MiniPane>
  );
}

// A course page rather than the catalogue: enough real text to read, so the
// pane says "you learn here" instead of showing thumbnails.
function MiniLearn({ visible }: { visible: boolean }) {
  return (
    <MiniPane visible={visible}>
      <div className="flex flex-1 flex-col justify-center px-7">
        <p className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-primary)]">
          BTC101 · Beginner · Chapter 1
        </p>
        <h4 className="mt-3 text-[19px] font-semibold text-[var(--alice-heading)]">
          The Bitcoin Journey
        </h4>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--alice-text)]">
          Money has changed shape many times: shells, gold, paper, plastic.
          Bitcoin is the next step, the first money that lives on the internet
          and belongs to no company and no state. In this course you will
          follow its whole journey, from why it was invented to how you hold
          it yourself.
        </p>
        <div className="mt-5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--alice-border)]">
            <div className="h-full w-[8%] rounded-full bg-[var(--alice-primary)]" />
          </div>
          <p className="mt-2 text-[11px] text-[var(--alice-muted)]">Chapter 1 of 25 · 7h</p>
        </div>
      </div>
    </MiniPane>
  );
}

// The wallet, reduced to balance and actions. Everything on Mutinynet, and
// the pane says so the same way the app does.
function MiniWallet({ visible }: { visible: boolean }) {
  return (
    <MiniPane visible={visible}>
      <div className="flex items-center justify-between px-7 pt-6">
        <p className="font-pixel text-[11px] uppercase tracking-widest text-[var(--alice-heading)]">
          Playground
        </p>
        <span className="rounded-[2px] bg-[#e5484d] px-2 py-1 font-pixel text-[8px] uppercase tracking-wider text-white">
          Mutinynet · Test funds
        </span>
      </div>
      <p className="mx-7 mt-3 border border-dashed border-[#e5484d] px-3 py-2 text-center font-pixel text-[8px] uppercase tracking-wider text-[#ff8a8e]">
        A place to learn and experiment. These sats have no real value.
      </p>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="text-center">
          <p className="font-pixel text-[26px] text-[var(--alice-heading)]">21,000</p>
          <p className="mt-1.5 text-[12px] text-[var(--alice-muted)]">sats · free from the faucet</p>
        </div>
        <div className="flex items-center gap-3">
          {['Send', 'Receive', 'Free sats'].map((label) => (
            <span
              key={label}
              className="rounded-[3px] border-2 border-[var(--alice-border)] px-5 py-3 font-pixel text-[11px] uppercase tracking-wider text-[var(--alice-heading)]"
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </MiniPane>
  );
}

function MiniApp({ active }: { active: number }) {
  return (
    <div className="absolute inset-0 flex">
      <MiniSidebar active={active} />
      <div className="relative flex-1" style={{ backgroundColor: 'var(--alice-bg)' }}>
        <MiniExplorer visible={active === 1} />
        <MiniLearn visible={active === 2} />
        <MiniWallet visible={active === 3} />
        <MiniChat visible={active <= 0} />
      </div>
    </div>
  );
}

// Small screens: a single phone pinned under the nav, its screen crossfading
// as the steps scroll beneath it. A phone showing a desktop app would be the
// one thing this section must not do.
function MobilePhoneStack({ active }: { active: number }) {
  const current = Math.max(active, 0);
  return (
    <div
      className="relative h-[40vh] overflow-hidden rounded-[16px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg)]"
      style={{ aspectRatio: '390 / 844' }}
    >
      {SCREENS.map((screen, i) => (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={screen.src}
          src={screen.src}
          alt={screen.alt}
          loading={i === 0 ? 'eager' : 'lazy'}
          className="absolute inset-0 h-full w-full object-cover object-top transition-opacity duration-300"
          style={{ opacity: current === i ? 1 : 0 }}
        />
      ))}
    </div>
  );
}


export function HeroTour() {
  // -1 = the hero zone (mini ask interface); 0..3 = tour steps (captures).
  const [active, setActive] = useState(-1);
  const zoneRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  // Below lg the grid collapses and the phone pins over the steps.
  useStepClip(zoneRef, pinnedRef, '(max-width: 1023px)');

  useEffect(() => {
    const els = zoneRef.current?.querySelectorAll<HTMLElement>('[data-step]');
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
    <section id="app" className="mx-auto max-w-6xl scroll-mt-24 px-5 pt-16 sm:pt-20">
      <div ref={zoneRef} className="lg:grid lg:grid-cols-[5fr_6fr] lg:gap-12">
        {/* Left column: hero, proofs, then the tour steps. */}
        <div>
          <div data-step={-1}>
            <p className="font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)]">
              Private Bitcoin AI · Self-custody · Open source
            </p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] sm:text-5xl">
              {HERO_TITLE}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-[var(--alice-text)]">
              Alice guides you all the way down the Bitcoin rabbit hole: she
              explains in plain words, walks you into self-custody, and answers
              every question locally on your device or end-to-end encrypted.{' '}
              <span className="text-[var(--alice-heading)]">And she can never touch your keys.</span>
            </p>
            <div className="mt-8">
              <AppCtas size="md" />
              <ReleaseLinks />
            </div>

            <VerifyBlock />
          </div>

          <p className="mt-16 font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)] sm:mt-20">
            Inside the app
          </p>
          <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">
            Take the tour without installing anything.
          </h2>

          {/* Phone and tablet: the phone pins above the steps, the ask
              interface lives in the sticky bottom bar instead. No background
              band: the page grid stays visible around the phone, and the
              step text is cut clean at an invisible line under it (useStepClip). */}
          <div ref={pinnedRef} className="sticky top-16 z-10 mt-8 flex justify-center lg:hidden">
            <MobilePhoneStack active={active} />
          </div>

          {SCREENS.map((screen, i) => (
            <div
              key={screen.title}
              data-step={i}
              // The first step opens clear of the pinned phone's clip line,
              // or it would open half-cut before any scrolling happens.
              className={`flex min-h-[40vh] flex-col justify-center py-6 lg:min-h-[52vh] ${i === 0 ? 'mt-24 lg:mt-0' : ''}`}
            >
              <p className="font-pixel text-[12px] uppercase tracking-widest text-[var(--alice-primary)]">
                {screen.eyebrow}
              </p>
              <p className="mt-3 text-lg leading-relaxed text-[var(--alice-text)]">{screen.body}</p>
              {/* The step's title doubles as its call to action: one line
                  fewer, and the button says where it leads. */}
              <a
                href={screen.appHref}
                className="raise mt-6 inline-flex w-fit items-center gap-2 rounded-[3px] border-2 border-[var(--alice-primary)] px-5 py-2.5 text-[15px] font-semibold text-[var(--alice-primary)]"
              >
                {screen.title} →
              </a>
            </div>
          ))}
        </div>

        {/* Desktop: the one persistent Alice screen, a working miniature of
            the app. Welcome screen first, the other rooms during the tour,
            unpinned after the last step. */}
        <div className="hidden lg:block">
          <div className="sticky top-24 pt-2">
            <WindowFrame
              label={active === WALLET_STEP ? 'Alice Wallet · on your phone' : 'app.alicebtc.com'}
            >
              <MiniApp active={active} />
              {/* The wallet has no desktop build, so its step swaps the whole
                  app for a phone standing in the same stage. */}
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center transition-opacity duration-300"
                style={{
                  opacity: active === WALLET_STEP ? 1 : 0,
                  backgroundColor: 'var(--alice-bg)',
                }}
                aria-hidden={active !== WALLET_STEP}
              >
                <PhoneScreen
                  src={SCREENS[WALLET_STEP].src}
                  alt={SCREENS[WALLET_STEP].alt}
                  className="h-[88%]"
                />
              </div>
            </WindowFrame>
          </div>
        </div>
      </div>
    </section>
  );
}
