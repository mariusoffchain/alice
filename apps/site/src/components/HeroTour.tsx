'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { APP_URL, HERO_TITLE, appQuestionUrl } from '@/lib/site';
import { useStepClip } from '@/lib/use-step-clip';
import { AppCtas, ReleaseLinks } from '@/components/AppCtas';
import { VerifyBlock } from '@/components/VerifyBlock';
import { externalLinkProps } from '@/lib/links';
import { ChevronDownIcon, SendIcon, ReceiveIcon, RefreshIcon } from '@/components/icons';
import { rabbitPaths } from '@/lib/rabbit-paths';

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

// Every step carries a real phone capture, used for each
// app tour step on small screens.
// Taken from a fresh headless profile, so no personal data can appear.
const SCREENS: { src: string; alt: string; eyebrow: string; title: string; body: string; appHref: string }[] = [
  {
    src: '/screens/mobile/chat.webp',
    alt: 'The updated Alice chat on a phone, with the rabbit beside its greeting and model controls below',
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

];

function WindowFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[4px] border border-[var(--alice-border)] bg-[var(--alice-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--alice-border)] px-4 py-2.5">
        <span className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-muted)]">
          {label}
        </span>
      </div>
      <div className="relative aspect-[16/10]">{children}</div>
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
  newChat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="16" height="16" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M9 2h2v7h7v2h-7v7H9v-7H2V9h7z"/></svg>`,
  explorer: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="16" height="16" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M6 1h8v2h3v3h2v8h-2v3h-3v2H6v-2H3v-3H1V6h2V3h3zm0 2v2H4v2H3v6h1v2h2v2h8v-2h2v-2h1V7h-1V5h-2V3zm6 3h3l-3 6-7 3 3-7zm-2 3-2 3 3-1 1-3z"/></svg>`,
  learn: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="16" height="16" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M1 3h7l2 2 2-2h7v13h-7l-2 2-2-2H1zm2 2v9h5l1 1V6L7 5zm8 1v9l1-1h5V5h-4z"/></svg>`,
  playground: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="16" height="16" fill="{{COLOR}}" shape-rendering="crispEdges" aria-hidden="true"><path d="M4 4h12v2h2v10h-4v-2H6v2H2V6h2zm0 2v8h1v-2h10v2h1V6zm2 1h2v2h2v2H8v2H6v-2H4V9h2zm6 1h2v2h-2zm2 3h2v2h-2z"/></svg>`,
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
            color: i === activeItem ? 'var(--alice-heading)' : 'var(--alice-muted)',
            backgroundColor: 'transparent',
          }}
        >
          <MiniIcon svg={item.icon} size={15} color="currentColor" />
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

// Questions the empty input "types" on its own, one character at a time, so a
// visitor understands at a glance that this is a real input they can use, not
// a picture of one. It stops the moment they focus or type, and it does not
// run at all for people who asked their system for reduced motion.
const TYPED_EXAMPLES = [
  'What is self-custody?',
  'Is my AI chat private?',
  'How do I secure my Bitcoin?',
  'What is the Ark protocol?',
];
const TYPE_MS = 55;
const ERASE_MS = 22;
const HOLD_MS = 1_800;
const PAUSE_MS = 500;

function useTypedPlaceholder(active: boolean): string {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!active) { setText(''); return; }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let example = 0;
    let length = 0;
    let erasing = false;
    const step = () => {
      if (cancelled) return;
      const target = TYPED_EXAMPLES[example];
      if (!erasing) {
        length += 1;
        setText(target.slice(0, length) + '|');
        if (length < target.length) { timer = setTimeout(step, TYPE_MS); return; }
        erasing = true;
        timer = setTimeout(step, HOLD_MS);
        return;
      }
      length -= 1;
      setText(target.slice(0, length) + '|');
      if (length > 0) { timer = setTimeout(step, ERASE_MS); return; }
      erasing = false;
      example = (example + 1) % TYPED_EXAMPLES.length;
      timer = setTimeout(step, PAUSE_MS);
    };
    timer = setTimeout(step, 900);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [active]);
  return text;
}

function MiniChat({ visible }: { visible: boolean }) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [focused, setFocused] = useState(false);
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);
  const typed = useTypedPlaceholder(visible && !focused && value === '');

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
      inert={!visible}
    >
      <div className="flex flex-1 flex-col justify-end gap-3 px-5 pb-3">
        <div className="flex items-center gap-3">
          <svg width="28" height="32" viewBox="0 0 40 40" fill="currentColor" className="shrink-0 text-[var(--alice-primary)]" aria-hidden="true"><path d={typing ? rabbitPaths.attention : rabbitPaths.repos} /></svg>
          <p className="text-[14px] leading-relaxed text-[var(--alice-heading)]">Hi! What would you like to learn about today?</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-10">
          {APP_SUGGESTIONS.map((question) => (
            <button
              key={question}
              type="button"
              disabled={submitting}
              onClick={() => go(question)}
              className="mini-suggestion"
            >
              {question}
            </button>
          ))}
        </div>
      </div>
      <form
        className="pl-[60px] pr-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) go(value.trim());
        }}
      >
        <div className="flex flex-col gap-4 rounded-[4px] border border-[var(--alice-border)] px-4 py-3 focus-within:border-[var(--alice-primary)]">
          <input
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setTyping(true); if (typingTimer.current) clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(false), 1600); }}
            disabled={submitting}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setTyping(false); }}
            placeholder={typed || 'Ask Alice something...'}
            aria-label="Ask Alice a question"
            className="w-full bg-transparent text-[14px] text-[var(--alice-heading)] placeholder:text-[var(--alice-muted)] focus:outline-none"
          />
          <div className="flex items-center justify-end gap-3">
            <span className="inline-flex items-center gap-2 text-[10px] leading-none" aria-label="Model: Private. Reasoning: Medium."><span className="text-[var(--alice-heading)]">Private</span><span className="text-[var(--alice-muted)]">Medium</span></span>
            <button
              type="submit"
              disabled={submitting}
              aria-label={submitting ? 'Opening Alice' : 'Ask Alice'}
              className="cta-solid flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[3px] text-[var(--alice-on-primary)] disabled:cursor-wait"
            >
              {submitting ? '·' : <SendIcon size={14} />}
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
      <div className="px-5 pt-5">
        <p className="font-pixel text-[10px] text-[var(--alice-muted)]">Live blocks</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {BLOCK_TILES.slice(0, 3).map((block) => (
            <div key={block.height} className={`min-w-0 rounded-[4px] border px-2 py-2 ${block.pending ? 'border-dashed border-[var(--alice-border)]' : 'border-[var(--alice-border)] border-t-2 border-t-[var(--alice-primary)]'}`}>
              <p className="text-[11px] font-medium text-[var(--alice-heading)]">{block.height}</p>
              <p className="mt-1 text-[10px] text-[var(--alice-muted)]">{block.fee}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-4 border-b border-[var(--alice-border)] pb-2 text-[11px]">
          <span className="inline-flex items-center gap-1 text-[var(--alice-muted)]">Bitcoin <ChevronDownIcon size={10} /></span>
          <span className="text-[var(--alice-heading)]">Transaction</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center px-5 pb-4">
        <p className="text-[11px] text-[var(--alice-muted)]">Transaction flow</p>
        <svg viewBox="0 0 420 150" className="mt-2 max-h-[110px] w-full" aria-hidden="true">
          <path d="M0,45 C120,45 130,72 205,72" fill="none" stroke="var(--alice-primary)" strokeOpacity="0.45" strokeWidth="14" />
          <path d="M0,110 C120,110 130,84 205,84" fill="none" stroke="var(--alice-primary)" strokeOpacity="0.45" strokeWidth="9" />
          <path d="M215,70 C290,70 300,32 420,32" fill="none" stroke="var(--alice-primary)" strokeWidth="11" />
          <path d="M215,78 C290,78 300,78 420,78" fill="none" stroke="var(--alice-primary)" strokeWidth="8" />
          <path d="M215,86 C290,86 300,124 420,124" fill="none" stroke="var(--alice-primary)" strokeWidth="5" />
          <rect x="203" y="58" width="12" height="40" fill="var(--alice-heading)" />
        </svg>
        <div className="mt-2 flex justify-between text-[10px] text-[var(--alice-muted)]"><span>2 inputs · 0.50 BTC</span><span>3 outputs</span></div>
      </div>
    </MiniPane>
  );
}

// A course page rather than the catalogue: enough real text to read, so the
// pane says "you learn here" instead of showing thumbnails.
function MiniLearn({ visible }: { visible: boolean }) {
  return (
    <MiniPane visible={visible}>
      <div className="flex flex-1 flex-col justify-center px-5">
        <p className="font-pixel text-[10px] uppercase tracking-widest text-[var(--alice-primary)]">
          BTC101
        </p>
        <h4 className="mini-course-title mt-3 text-[19px] text-[var(--alice-heading)]">
          The Bitcoin Journey
        </h4>
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--alice-text)]">
          Money has changed shape many times: shells, gold, paper, plastic.
          Bitcoin is the next step, the first money that lives on the internet
          and belongs to no company and no state. In this course you will
          follow its whole journey, from why it was invented to how you hold
          it yourself.
        </p>
        <div className="mt-5">
          <div className="mini-course-progress" aria-hidden="true">{Array.from({ length: 25 }, (_, i) => <span key={i} />)}</div>
          <p className="mt-2 text-[11px] text-[var(--alice-muted)]">Chapter 1 of 25 · 7h</p>
        </div>
      </div>
    </MiniPane>
  );
}

// The wallet, reduced to balance and actions. Everything on Mutinynet, and
// the pane says so the same way the app does.
function MiniPlayground({ visible }: { visible: boolean }) {
  return (
    <MiniPane visible={visible}>
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between gap-2"><p className="font-pixel text-[10px] text-[var(--alice-heading)]">Playground</p><span className="text-[10px] text-[var(--alice-muted)]">Mutinynet</span></div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--alice-muted)]">Learn by experimenting. These sats have no real value.</p>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5">
        <div className="text-center"><p className="font-pixel text-[21px] text-[var(--alice-primary)]">21,000</p><p className="mt-2 text-[11px] text-[var(--alice-muted)]">test sats</p></div>
        <span className="inline-flex items-center gap-2 text-[11px] text-[var(--alice-muted)]"><RefreshIcon size={13} /> Refresh</span>
        <div className="flex w-full justify-center gap-3 text-[11px] text-[var(--alice-primary)]">
          <span className="inline-flex items-center gap-1.5 py-2"><SendIcon size={14} /> Send</span>
          <span className="inline-flex items-center gap-1.5 py-2"><ReceiveIcon size={14} /> Receive</span>
          <span className="inline-flex items-center py-2">Free sats</span>
        </div>
      </div>
    </MiniPane>
  );
}

function MiniApp({ active }: { active: number }) {
  return (
    <div className="mini-app absolute inset-0 flex">
      <MiniSidebar active={active} />
      <div className="relative flex-1" style={{ backgroundColor: 'var(--alice-bg)' }}>
        <MiniExplorer visible={active === 1} />
        <MiniLearn visible={active === 2} />
        <MiniPlayground visible={active === 3} />
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
      className="relative h-[40vh] overflow-hidden rounded-[16px] border border-[var(--alice-border)] bg-[var(--alice-bg)]"
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
    <section data-tour-step={active} id="app" className="mx-auto max-w-6xl scroll-mt-24 px-5 pt-16 sm:pt-20">
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
                {...externalLinkProps(screen.appHref)}
                className="raise mt-6 inline-flex w-fit items-center gap-2 rounded-[3px] border border-[var(--alice-primary)] px-5 py-2.5 text-[15px] font-semibold text-[var(--alice-primary)]"
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
          <div data-tour-panel className="sticky top-24 pt-2">
            <WindowFrame
              label="app.alicebtc.com"
            >
              <MiniApp active={active} />
            </WindowFrame>
          </div>
        </div>
      </div>
    </section>
  );
}
