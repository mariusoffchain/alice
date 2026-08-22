'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DownloadNotice, type DownloadPlatform } from '@/components/DownloadNotice';
import {
  ANDROID_APK_URL,
  ANDROID_RELEASE_URL,
  ANDROID_VERSION,
  APP_URL,
  DESKTOP_LINUX_APPIMAGE_URL,
  DESKTOP_LINUX_DEB_URL,
  DESKTOP_MAC_URL,
  DESKTOP_RELEASE_URL,
  DESKTOP_VERSION,
  DESKTOP_WINDOWS_URL,
  WALLET_URL,
} from '@/lib/site';
import {
  DesktopIcon,
  GlobeIcon,
  DownloadIcon,
  AppleGlyph,
  WindowsGlyph,
  LinuxGlyph,
  AndroidGlyph,
  ChevronDownIcon,
  ShieldCheckIcon,
} from '@/components/icons';

type Size = 'sm' | 'md';

const sizes: Record<Size, string> = {
  sm: 'px-3.5 py-1.5 text-sm',
  md: 'px-5 py-3 text-base',
};

export type PlatformItem = {
  icon: ReactNode;
  label: string;
  href?: string;
  /** Set when the download triggers an OS warning worth explaining first. */
  notice?: DownloadPlatform;
};

// The two platform lists, shared between the CTA dropdowns and the mobile
// nav menu so no surface can drift out of sync with what is actually
// distributed. Items with no href render as "Coming soon".
export const APP_PLATFORM_ITEMS: PlatformItem[] = [
  { icon: <GlobeIcon size={18} />, label: 'Web app', href: APP_URL },
  { icon: <AppleGlyph size={18} />, label: `Mac ${DESKTOP_VERSION}`, href: DESKTOP_MAC_URL, notice: 'macos' },
  { icon: <WindowsGlyph size={16} />, label: `Windows ${DESKTOP_VERSION}`, href: DESKTOP_WINDOWS_URL, notice: 'windows' },
  // Linux raises no platform warning, so both packages link straight through.
  { icon: <LinuxGlyph size={18} />, label: `Linux AppImage ${DESKTOP_VERSION}`, href: DESKTOP_LINUX_APPIMAGE_URL },
  { icon: <LinuxGlyph size={18} />, label: `Linux Debian ${DESKTOP_VERSION}`, href: DESKTOP_LINUX_DEB_URL },
  { icon: <DownloadIcon size={18} />, label: 'Release & checksum', href: DESKTOP_RELEASE_URL },
];

export const WALLET_PLATFORM_ITEMS: PlatformItem[] = [
  { icon: <AppleGlyph size={18} />, label: 'iOS' },
  { icon: <AndroidGlyph size={18} />, label: 'Android' },
  {
    icon: <DownloadIcon size={18} />,
    label: `Beta APK ${ANDROID_VERSION}`,
    href: ANDROID_APK_URL,
    notice: 'android',
  },
  // "Web wallet", not "Web app": the App group has a row of that exact name,
  // and two identical labels in one menu is a coin toss for the reader.
  { icon: <GlobeIcon size={18} />, label: 'Web wallet', href: WALLET_URL },
  { icon: <DownloadIcon size={18} />, label: 'Release & checksum', href: ANDROID_RELEASE_URL },
];

export type PlatformGroup = { label: string; items: PlatformItem[] };

// Everything Alice ships, in one list. Two products, so the menu names them
// rather than pretending there is only one; the nav's other button is the
// one that just opens the companion.
export const DOWNLOAD_GROUPS: PlatformGroup[] = [
  { label: 'Alice App', items: APP_PLATFORM_ITEMS },
  { label: 'Alice Wallet', items: WALLET_PLATFORM_ITEMS },
];

// Available items get a real link; items with no href (not yet distributed)
// render as plain, non-interactive rows labelled "Coming soon", the same
// honesty pattern used on /trust rather than a dead or invented link.
// `compact` is for the phone menu, where two columns share 375px. The icon
// stays, because a platform list without its glyphs is a wall of words: only
// the "Coming soon" note moves to a second line to buy the width back.
export function PlatformRow({ icon, label, href, notice, compact }: PlatformItem & { compact?: boolean }) {
  // An unsigned build is about to scare this person. Say it first: the dialog
  // takes the click, explains the exact screen coming, and only then hands
  // over the file.
  const [showNotice, setShowNotice] = useState(false);
  const box = compact
    ? 'flex flex-col gap-0.5 rounded-[3px] px-2 py-2'
    : 'flex items-center gap-3 rounded-[3px] px-3 py-2.5';
  const inner = compact ? (
    <>
      <span className="flex items-center gap-2">
        <span className="shrink-0 text-[var(--alice-primary)]">{icon}</span>
        <span className="text-[13px] font-semibold text-[var(--alice-heading)]">{label}</span>
      </span>
      {!href && <span className="pl-[26px] text-[10px] text-[var(--alice-muted)]">Coming soon</span>}
    </>
  ) : (
    <>
      <span className="text-[var(--alice-primary)]">{icon}</span>
      <span className="flex-1 text-[14px] font-semibold text-[var(--alice-heading)]">{label}</span>
      {!href && <span className="text-[11px] text-[var(--alice-muted)]">Coming soon</span>}
    </>
  );
  if (href && notice) {
    return (
      <>
        <button
          type="button"
          role="menuitem"
          onClick={() => setShowNotice(true)}
          className={`${box} w-full cursor-pointer bg-transparent text-left transition-colors hover:bg-[var(--alice-bg)]`}
        >
          {inner}
        </button>
        {showNotice && (
          <DownloadNotice
            platform={notice}
            href={href}
            verifyHref={notice === 'android' ? ANDROID_RELEASE_URL : DESKTOP_RELEASE_URL}
            onCancel={() => setShowNotice(false)}
          />
        )}
      </>
    );
  }
  if (href) {
    return (
      <a
        href={href}
        role="menuitem"
        className={`${box} transition-colors hover:bg-[var(--alice-bg)]`}
      >
        {inner}
      </a>
    );
  }
  return (
    <div
      role="menuitem"
      aria-disabled="true"
      className={`${box} opacity-50`}
    >
      {inner}
    </div>
  );
}

// Hover/focus panel of platform-specific options, layered under a trigger CTA.
// Its top padding keeps a visual gap while remaining part of the hit area, so
// moving the pointer from the CTA to an item cannot close the panel mid-way.
function PlatformMenu({
  groups,
  placement,
}: {
  groups: PlatformGroup[];
  placement: { width: number; left: number; compact: boolean };
}) {
  return (
    <div
      className="platform-menu absolute top-full z-[70] pt-2"
      style={{ width: placement.width, left: placement.left }}
    >
      {/* Two products, two columns: stacking them made one long list where
          the reader had to hunt for the boundary. */}
      <div
        role="menu"
        className="grid grid-cols-2 gap-1.5 rounded-[6px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg-soft)] p-1.5 shadow-xl"
      >
        {groups.map((group, i) => (
          <div
            key={group.label}
            className={i > 0 ? 'border-l border-[var(--alice-border)] pl-1.5' : ''}
          >
            {/* No glyph on the group title: the icons belong to the rows,
                where they say which platform. One in the header only competes
                with them, and costs the title its single line. */}
            <div className={`${placement.compact ? 'px-2' : 'px-3'} pb-1 pt-1`}>
              <span className="whitespace-nowrap font-pixel text-[9px] uppercase tracking-widest text-[var(--alice-muted)]">
                {group.label}
              </span>
            </div>
            {group.items.map((item) => (
              <PlatformRow key={`${group.label}:${item.label}`} {...item} compact={placement.compact} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// A click (or tap) toggles the menu; on devices with a real pointer, hovering
// the trigger is enough (see .platform-selector in globals.css). The click
// path needs state rather than a bare <details> so an open menu can close on
// outside click or Escape instead of staying pinned over the page.
function PlatformSelector({
  trigger,
  className,
  groups,
}: {
  trigger: ReactNode;
  className: string;
  groups: PlatformGroup[];
}) {
  const [open, setOpen] = useState(false);
  // The panel is placed in viewport pixels, never by edge: centred on its
  // button, clamped 12px inside the viewport, and no wider than the viewport
  // allows. That is what keeps it whole on a phone, where the desktop-width
  // panel used to be cropped by the screen edges. Measured on mount and
  // resize (not on open), so the CSS hover-open path finds it ready too;
  // narrow placements switch the rows to their compact shape.
  const [placement, setPlacement] = useState({ width: 480, left: 0, compact: false });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const vw = window.innerWidth;
      const width = Math.min(480, vw - 24);
      const centre = rect.left + rect.width / 2;
      const inViewport = Math.min(Math.max(centre - width / 2, 12), vw - 12 - width);
      setPlacement({ width, left: inViewport - rect.left, compact: width < 460 });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="platform-selector relative inline-block"
      data-open={open || undefined}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`${className} cursor-pointer`}
      >
        {trigger}
        <ChevronDownIcon size={14} />
      </button>
      <PlatformMenu groups={groups} placement={placement} />
    </div>
  );
}

// The primary action, and the only one that needs no decision from the
// visitor: open the companion, which runs in any browser, phone included.
// Alice App is the main product and the whole page says so; the wallet is
// where practice becomes real, and it has its own step in the tour.
export function OpenAliceButton({ size = 'md' }: { size?: Size }) {
  return (
    <a href={APP_URL} className={`cta cta-solid ${sizes[size]}`}>
      Open Alice
    </a>
  );
}

// Everything installable, behind one button: both products, each platform
// named, nothing invented (undistributed platforms say "Coming soon").
export function DownloadButton({ size = 'md' }: { size?: Size }) {
  return (
    <PlatformSelector
      className={`cta ${sizes[size]}`}
      trigger={
        <>
          <DownloadIcon size={size === 'sm' ? 16 : 18} />
          Download
        </>
      }
      groups={DOWNLOAD_GROUPS}
    />
  );
}

export function ReleaseLinks() {
  return (
    <div className="mt-3 flex items-center text-sm">
      <a
        href={ANDROID_RELEASE_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 text-[var(--alice-muted)] hover:text-[var(--alice-primary)] hover:underline"
      >
        <ShieldCheckIcon size={16} />
        Release notes & checksum →
      </a>
    </div>
  );
}

// The pair: open the companion (filled, the action most visitors want) and
// everything installable (outline).
export function AppCtas({ size = 'md' }: { size?: Size }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <OpenAliceButton size={size} />
      <DownloadButton size={size} />
    </div>
  );
}
