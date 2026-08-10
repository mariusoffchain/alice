import type { ReactNode } from 'react';
import {
  ANDROID_APK_URL,
  ANDROID_RELEASE_URL,
  ANDROID_VERSION,
  APP_URL,
  WALLET_URL,
} from '@/lib/site';
import {
  DesktopIcon,
  PhoneIcon,
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
        role="menuitem"
        className="flex items-center gap-3 rounded-[3px] px-3 py-2.5 transition-colors hover:bg-[var(--alice-bg)]"
      >
        {inner}
      </a>
    );
  }
  return (
    <div
      role="menuitem"
      aria-disabled="true"
      className="flex items-center gap-3 rounded-[3px] px-3 py-2.5 opacity-50"
    >
      {inner}
    </div>
  );
}

// Hover/focus panel of platform-specific options, layered under a trigger CTA.
// Its top padding keeps a visual gap while remaining part of the hit area, so
// moving the pointer from the CTA to an item cannot close the panel mid-way.
function PlatformMenu({ items }: { items: PlatformItem[] }) {
  return (
    <div className="absolute right-0 top-full z-[70] w-56 pt-2">
      <div
        role="menu"
        className="rounded-[6px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg-soft)] p-1.5 shadow-xl"
      >
        {items.map((item) => (
          <PlatformRow key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

function PlatformTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <summary
      aria-haspopup="menu"
      className={`${className} list-none [&::-webkit-details-marker]:hidden`}
    >
      {children}
      <ChevronDownIcon size={14} />
    </summary>
  );
}

function PlatformSelector({
  trigger,
  className,
  items,
}: {
  trigger: ReactNode;
  className: string;
  items: PlatformItem[];
}) {
  return (
    <details className="relative inline-block">
      <PlatformTrigger className={className}>{trigger}</PlatformTrigger>
      <PlatformMenu items={items} />
    </details>
  );
}

// Desktop entry. The trigger only reveals the platform choices. Opening the
// web app remains an explicit action inside the menu.
export function DesktopAppButton({ size = 'md' }: { size?: Size }) {
  return (
    <PlatformSelector
      className={`cta cta-desktop ${sizes[size]}`}
      trigger={
        <>
          <DesktopIcon size={size === 'sm' ? 16 : 18} />
          Desktop app
        </>
      }
      items={[
        { icon: <GlobeIcon size={18} />, label: 'Web app', href: APP_URL },
        { icon: <AppleGlyph size={18} />, label: 'Mac' },
        { icon: <WindowsGlyph size={16} />, label: 'Windows' },
        { icon: <LinuxGlyph size={18} />, label: 'Linux' },
      ]}
    />
  );
}

// Mobile entry. Android store distribution and the directly installable beta
// APK are distinct so the menu never implies that a store release exists.
export function MobileWalletButton({ size = 'md' }: { size?: Size }) {
  return (
    <PlatformSelector
      className={`cta cta-mobile ${sizes[size]}`}
      trigger={
        <>
          <PhoneIcon size={size === 'sm' ? 16 : 18} />
          Mobile wallet
        </>
      }
      items={[
        { icon: <AppleGlyph size={18} />, label: 'iOS' },
        { icon: <AndroidGlyph size={18} />, label: 'Android' },
        {
          icon: <DownloadIcon size={18} />,
          label: `Beta APK ${ANDROID_VERSION}`,
          href: ANDROID_APK_URL,
        },
        { icon: <GlobeIcon size={18} />, label: 'Web app', href: WALLET_URL },
        { icon: <DownloadIcon size={18} />, label: 'Release & checksum', href: ANDROID_RELEASE_URL },
      ]}
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
