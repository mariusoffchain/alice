// Small hand-rolled icons (the site has no icon library). Stroke uses
// currentColor so they inherit the button/text color.

export function PhoneIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <line x1="11" y1="18.5" x2="13" y2="18.5" />
    </svg>
  );
}

export function DesktopIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <line x1="8" y1="20.5" x2="16" y2="20.5" />
      <line x1="12" y1="16" x2="12" y2="20.5" />
    </svg>
  );
}

export function LaptopIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="10" rx="1.5" />
      <line x1="2" y1="18.5" x2="22" y2="18.5" />
    </svg>
  );
}

export function CloudIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 18.5h9a3.5 3.5 0 0 0 .4-6.98 5 5 0 0 0-9.55-1.02A3.75 3.75 0 0 0 7.5 18.5Z" />
      <rect x="10" y="11.5" width="4" height="3.2" rx="0.6" />
      <path d="M10.6 11.5v-0.8a1.4 1.4 0 0 1 2.8 0v0.8" />
    </svg>
  );
}

export function KeyIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="15" r="3.5" />
      <line x1="10.5" y1="12.5" x2="20" y2="3" />
      <line x1="20" y1="3" x2="20" y2="6.5" />
      <line x1="17" y1="6" x2="19.5" y2="6" />
    </svg>
  );
}

export function BookIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 6.5c-1.6-1-4.2-1.5-6.5-1.5v12c2.3 0 4.9.5 6.5 1.5" />
      <path d="M12 6.5c1.6-1 4.2-1.5 6.5-1.5v12c-2.3 0-4.9.5-6.5 1.5" />
      <path d="M12 6.5V19" />
    </svg>
  );
}

export function CompassIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z" />
    </svg>
  );
}

export function ShieldIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 2.6v5.2c0 4.4-3 7.5-7 9.2-4-1.7-7-4.8-7-9.2V5.6z" />
    </svg>
  );
}

export function ShieldCheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 2.6v5.2c0 4.4-3 7.5-7 9.2-4-1.7-7-4.8-7-9.2V5.6z" />
      <path d="M9 11.8l2 2 4-4" />
    </svg>
  );
}

export function GlobeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.4 2.4 3.6 5.6 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.6-3.6-9s1.2-6.6 3.6-9Z" />
    </svg>
  );
}

export function DownloadIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 17v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// Simplified own line-art platform marks (not a reproduction of any trademarked
// logo file), sized to read clearly at ~18-20px next to the other icons.
export function AppleGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15.6 2.6c.1 1.1-.3 2.2-1 3-.7.8-1.9 1.5-3 1.4-.1-1.1.4-2.2 1-3 .8-.9 2-1.5 3-1.4Z" />
      <path d="M19.8 17.3c-.5 1.2-.8 1.7-1.5 2.7-.9 1.4-2.2 3.1-3.9 3.1-1.4 0-1.8-.9-3.7-.9-1.9 0-2.4.9-3.7.9-1.6 0-2.8-1.5-3.8-2.9-2.4-3.4-2.7-7.4-1.2-9.5 1-1.5 2.7-2.4 4.2-2.4 1.5 0 2.5 1 3.7 1 1.2 0 1.9-1 3.7-1 1.3 0 2.8.7 3.7 2-3.3 1.8-2.8 6.5 1.5 8Z" />
    </svg>
  );
}

export function WindowsGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="3.5" width="8.2" height="8.2" />
      <rect x="13.3" y="3.5" width="8.2" height="8.2" />
      <rect x="2.5" y="12.3" width="8.2" height="8.2" />
      <rect x="13.3" y="12.3" width="8.2" height="8.2" />
    </svg>
  );
}

export function LinuxGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <ellipse cx="12" cy="10" rx="5.2" ry="6" />
      <path d="M8.5 15.5c-.6 1.6-1.6 2.7-2.4 4.4-.4.9.3 1.6 1.2 1.2 1-.5 1.6-1 2.8-1 .8 0 1.1.7 1.9.7s1.1-.7 1.9-.7c1.2 0 1.8.5 2.8 1 .9.4 1.6-.3 1.2-1.2-.8-1.7-1.8-2.8-2.4-4.4" />
      <circle cx="9.8" cy="8.8" r="1" fill="var(--alice-bg)" />
      <circle cx="14.2" cy="8.8" r="1" fill="var(--alice-bg)" />
    </svg>
  );
}

export function AndroidGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.5 10.5h11v6.2a1.3 1.3 0 0 1-1.3 1.3h-8.4a1.3 1.3 0 0 1-1.3-1.3v-6.2Z" />
      <rect x="4.8" y="10.5" width="1.8" height="5.5" rx="0.9" />
      <rect x="17.4" y="10.5" width="1.8" height="5.5" rx="0.9" />
      <rect x="9.5" y="18" width="1.6" height="3" rx="0.8" />
      <rect x="12.9" y="18" width="1.6" height="3" rx="0.8" />
      <path d="M7.3 9.6a4.7 4.7 0 0 1 9.4 0Z" />
      <circle cx="9.8" cy="7.7" r="0.55" fill="var(--alice-bg)" />
      <circle cx="14.2" cy="7.7" r="0.55" fill="var(--alice-bg)" />
      <line x1="8.3" y1="4.3" x2="9.3" y2="5.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="15.7" y1="4.3" x2="14.7" y2="5.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

// Alice brand mark: the app's keyhole icon plus the wordmark.
export function AliceMark({
  size = 28,
  showWordmark = true,
}: {
  size?: number;
  showWordmark?: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/alice-logo.svg"
        alt="Alice"
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className="block"
      />
      {showWordmark && (
        <span className="font-pixel text-[14px] text-[var(--alice-heading)]">Alice</span>
      )}
    </span>
  );
}
