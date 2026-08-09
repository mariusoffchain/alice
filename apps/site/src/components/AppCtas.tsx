import type { ReactNode } from 'react';
import { APP_URL, WALLET_URL } from '@/lib/site';
import {
  DesktopIcon,
  PhoneIcon,
  GlobeIcon,
  DownloadIcon,
  AppleGlyph,
  WindowsGlyph,
  LinuxGlyph,
  AndroidGlyph,
} from '@/components/icons';

type Size = 'sm' | 'md';

const sizes: Record<Size, string> = {
  sm: 'px-3.5 py-1.5 text-sm',
  md: 'px-5 py-3 text-base',
};

type PlatformItem = { icon: ReactNode; label: string; href?: string };

// Available items get a real link; items with no href (not yet distributed)
// render as plain, non-interactive rows labelled "Coming soon", the same
// honesty pattern used on /trust rather than a dead or invented link.
function PlatformRow({ icon, label, href }: PlatformItem) {
  const inner = (
    <>
      <span className="text-[var(--alice-primary)]">{icon}</span>
      <span className="flex-1 text-[14px] font-semibold text-[var(--alice-heading)]">{label}</span>
      {!href && <span className="text-[11px] text-[var(--alice-muted)]">Coming soon</span>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="flex items-center gap-3 rounded-[3px] px-3 py-2.5 transition-colors hover:bg-[var(--alice-bg)]"
      >
        {inner}
      </a>
    );
  }
  return <div className="flex items-center gap-3 rounded-[3px] px-3 py-2.5 opacity-50">{inner}</div>;
}

// Hover/focus panel of platform-specific options, layered under a trigger CTA.
// Its top padding keeps a visual gap while remaining part of the hit area, so
// moving the pointer from the CTA to an item cannot close the panel mid-way.
function PlatformMenu({ items }: { items: PlatformItem[] }) {
  return (
    <div
      className="pointer-events-none absolute right-0 top-full z-[70] w-56 pt-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
    >
      <div className="rounded-[6px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg-soft)] p-1.5 shadow-xl">
        {items.map((item) => (
          <PlatformRow key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

// Desktop entry. `.cta-desktop` makes it the filled/primary button on wide
// screens and an outline on narrow ones (see globals.css). Hovering (or
// focusing) reveals the platform choices for Alice on desktop.
export function DesktopAppButton({ size = 'md' }: { size?: Size }) {
  return (
    <div className="group relative inline-block">
      <a href={APP_URL} className={`cta cta-desktop ${sizes[size]}`}>
        <DesktopIcon size={size === 'sm' ? 16 : 18} />
        Desktop app
      </a>
      <PlatformMenu
        items={[
          { icon: <GlobeIcon size={18} />, label: 'Web app', href: APP_URL },
          { icon: <AppleGlyph size={18} />, label: 'Mac' },
          { icon: <WindowsGlyph size={16} />, label: 'Windows' },
          { icon: <LinuxGlyph size={18} />, label: 'Linux' },
        ]}
      />
    </div>
  );
}

// Mobile entry. `.cta-mobile` makes it the filled/primary button on narrow
// screens and an outline on wide ones. Hovering (or focusing) reveals the
// platform choices for Alice on mobile.
export function MobileWalletButton({ size = 'md' }: { size?: Size }) {
  return (
    <div className="group relative inline-block">
      <a href={WALLET_URL} className={`cta cta-mobile ${sizes[size]}`}>
        <PhoneIcon size={size === 'sm' ? 16 : 18} />
        Mobile wallet
      </a>
      <PlatformMenu
        items={[
          { icon: <AppleGlyph size={18} />, label: 'iOS' },
          { icon: <AndroidGlyph size={18} />, label: 'Android' },
          { icon: <GlobeIcon size={18} />, label: 'Web app', href: WALLET_URL },
          { icon: <DownloadIcon size={18} />, label: 'APK' },
        ]}
      />
    </div>
  );
}

// The two entries as a reusable pair. Whichever suits the visitor's device is
// the filled one; the other is the outline.
export function AppCtas({ size = 'md' }: { size?: Size }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <DesktopAppButton size={size} />
      <MobileWalletButton size={size} />
    </div>
  );
}
