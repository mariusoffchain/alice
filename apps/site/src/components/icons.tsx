import { ALICE_SYMBOL_PATH, ALICE_WORDMARK_PATH } from '@/lib/brand';
import { rabbitPaths } from '@/lib/rabbit-paths';

// Integer-grid glyphs shared visually with the approved application controls.
function PixelGlyph({ size, path }: { size: number; path: string }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true"><path fillRule="evenodd" d={path} /></svg>;
}

export function PhoneIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M5 1h10v18H5zm2 2v12h6V3zm2 13v1h2v-1z" />;
}

export function DesktopIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M1 2h18v12h-8v2h4v2H5v-2h4v-2H1zm2 2v8h14V4z" />;
}

export function LaptopIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M3 3h14v11H3zm2 2v7h10V5zM1 15h18v2H1z" />;
}

export function CloudIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M7 2h6v2h3v3h2v2h1v7H1V9h2V7h3V4h1zm1 2v5H4v2H3v3h14v-3h-3V8h-2V4z" />;
}

export function KeyIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M6 2h8v1H6zM5 3h10v1H5zM5 4h2v4H5zM13 4h2v4H13zM5 8h10v1H5zM6 9h8v1H6zM9 10h2v2H9zM9 12h6v2H9zM9 14h2v2H9zM9 16h6v2H9z" />;
}

export function BookIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M1 3h7l2 2 2-2h7v13h-7l-2 2-2-2H1zm2 2v9h5l1 1V6L7 5zm8 1v9l1-1h5V5h-4z" />;
}

export function CompassIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M6 1h8v2h3v3h2v8h-2v3h-3v2H6v-2H3v-3H1V6h2V3h3zm0 2v2H4v2H3v6h1v2h2v2h8v-2h2v-2h1V7h-1V5h-2V3zm6 3h3l-3 6-7 3 3-7zm-2 3-2 3 3-1 1-3z" />;
}

export function ShieldIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M8 1h4v1h3v1h3v9h-2v3h-2v2h-2v2H8v-2H6v-2H4v-3H2V3h3V2h3zm0 3H4v7h2v3h2v2h4v-2h2v-3h2V5h-4V4z" />;
}

export function ShieldCheckIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M8 1h4v1h3v1h3v9h-2v3h-2v2h-2v2H8v-2H6v-2H4v-3H2V3h3V2h3zm0 3H4v7h2v3h2v2h4v-2h2v-3h2V5h-4V4zM6 8h2v2h2V8h2V6h2v4h-2v2H8v-1H6z" />;
}

export function GlobeIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true"><path fillRule="evenodd" d="M6 1h8v2h3v3h2v8h-2v3h-3v2H6v-2H3v-3H1V6h2V3h3zm0 2v2H5v1H3v8h2v1h1v2h8v-2h1v-1h2V6h-2V5h-1V3z"/><path d="M2 9h16v2H2zM7 3h2v4H7zM6 7h2v6H6zM7 13h2v4H7zM11 3h2v4h-2zM12 7h2v6h-2zM11 13h2v4h-2z"/></svg>;
}

export function DownloadIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M9 2h2v6H9zM5 8h10v2H5zM7 10h6v2H7zM9 12h2v2H9zM3 14h2v2H3zM15 14h2v2H15zM3 16h14v2H3z" />;
}

export function ChevronDownIcon({ size = 20 }: { size?: number }) {
  return <PixelGlyph size={size} path="M3 6h2v2h2v2h2v2h2v-2h2V8h2V6h2v3h-2v2h-2v2h-2v2H9v-2H7v-2H5V9H3z" />;
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

// The D2 symbol is the A in the wordmark. The rabbit remains the assistant mascot.
export function AliceMark({ size = 22, showWordmark = true }: {
  size?: number;
  showWordmark?: boolean;
}) {
  return (
    <svg
      role="img"
      aria-label="Alice"
      data-alice-brand="d2"
      width={showWordmark ? size * 248 / 48 : size}
      height={size}
      viewBox={showWordmark ? '0 0 248 48' : '0 0 48 48'}
      fill="currentColor"
      shapeRendering="crispEdges"
      className="shrink-0 text-[var(--alice-primary)]"
    >
      <path d={showWordmark ? ALICE_WORDMARK_PATH : ALICE_SYMBOL_PATH} />
    </svg>
  );
}

export function AliceMascot({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="currentColor" className="shrink-0 text-[var(--alice-primary)]" aria-hidden="true"><path d={rabbitPaths.repos} /></svg>;
}

export function MenuIcon({ size = 16 }: { size?: number }) {
  return <PixelGlyph size={size} path="M2 4h16v2H2zm0 5h16v2H2zm0 5h11v2H2z" />;
}

export function CloseIcon({ size = 16 }: { size?: number }) {
  return <PixelGlyph size={size} path="M3 3h2v2h2v2h2v2h2V7h2V5h2V3h2v2h-2v2h-2v2h-2v2h2v2h2v2h2v2h-2v-2h-2v-2h-2v-2H9v2H7v2H5v2H3v-2h2v-2h2v-2h2V9H7V7H5V5H3z" />;
}

export function SendIcon({ size = 16 }: { size?: number }) {
  return <PixelGlyph size={size} path="M9 3h2v2h2v2h2v2h2v2h-3V9h-3v9H9V9H6v2H3V9h2V7h2V5h2z" />;
}

export function NextIcon({ size = 16 }: { size?: number }) {
  return <PixelGlyph size={size} path="M11 3h2v2h2v2h2v2h2v2h-2v2h-2v2h-2v2h-2v-3h2v-3H1V9h12V6h-2z" />;
}

export function ReceiveIcon({ size = 16 }: { size?: number }) {
  return <PixelGlyph size={size} path="M9 2h2v9h3V9h3v2h-2v2h-2v2h-2v2H9v-2H7v-2H5v-2H3V9h3v2h3z" />;
}

export function RefreshIcon({ size = 16 }: { size?: number }) {
  return <PixelGlyph size={size} path="M6 2h8v2h2v2h2V2h2v8h-8V8h4V6h-2V4H6v2H4v8h2v2h8v-2h2v-2h2v4h-2v2H4v-2H2V4h4z" />;
}
