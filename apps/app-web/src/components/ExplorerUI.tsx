'use client';

import { SvgIcon } from '@/components/SvgIcon';
import { INFO_ICON, COPY_ICON, CHECK_ICON } from '@/lib/atelier-icons';

// Shared visual primitives for Explorer, so every surface uses ONE type
// scale, ONE badge shape, and consistent empty/loading states. Kept tiny and
// dependency-free; colours come from the runtime --alice-* palette vars.
//
// Type scale (item 1/2): the pixel font is reserved for TITLES and short tags;
// everything read as running text uses the legible numbers font. Three sizes
// only: title, body, caption.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/* ----------------------------- Typography ----------------------------- */

/** A section title. Pixel font, used sparingly for headings only. */
export function SectionTitle({ children, muted = true }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className="font-pixel tracking-widest"
      style={{ fontSize: 10, color: muted ? 'var(--alice-muted)' : 'var(--alice-primary)' }}
    >
      {children}
    </span>
  );
}

/** A small field label: legible font in caps, NOT the pixel font (item 1). */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="font-numbers"
      style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--alice-muted)' }}
    >
      {children}
    </span>
  );
}

/** A labelled metric, one consistent layout everywhere. */
export function Metric({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <FieldLabel>{label}</FieldLabel>
      <span className="font-numbers" style={{ fontSize: 15, color: 'var(--alice-text)' }}>{value}</span>
    </div>
  );
}

/* ------------------------------- Badge -------------------------------- */

export type BadgeTone = 'neutral' | 'primary' | 'info' | 'low' | 'medium' | 'high' | 'danger';

// Every tone carries a text label already, so meaning never rests on colour
// alone (item 5). Colour just reinforces it.
const TONE: Record<BadgeTone, { fg: string; border: string }> = {
  neutral: { fg: 'var(--alice-muted)', border: 'var(--alice-border)' },
  primary: { fg: 'var(--alice-primary)', border: 'var(--alice-primary)' },
  info: { fg: 'var(--alice-info)', border: 'var(--alice-info)' },
  low: { fg: 'var(--alice-primary)', border: 'var(--alice-primary)' },
  medium: { fg: 'var(--alice-warning)', border: 'var(--alice-warning)' },
  high: { fg: 'var(--alice-danger)', border: 'var(--alice-danger)' },
  danger: { fg: 'var(--alice-danger)', border: 'var(--alice-danger)' },
};

/** One badge shape/size for the whole app (item 10). */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  const c = TONE[tone];
  return (
    <span
      className="font-numbers inline-flex items-center shrink-0"
      style={{
        fontSize: 10, lineHeight: 1, padding: '3px 6px', borderRadius: 'var(--alice-radius-control)',
        border: `1px solid ${c.border}`, color: c.fg, whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/* ---------------------------- Network dot ----------------------------- */

// A coloured square PLUS the network's first letter, so the network is legible
// without relying on colour vision (item 5).
export function NetworkDot({ color, label }: { color: string; label: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center shrink-0 font-pixel"
      title={label}
      style={{
        width: 14, height: 14, borderRadius: 3, backgroundColor: color,
        color: 'var(--alice-bg)', fontSize: 10, fontWeight: 700,
      }}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

/* --------------------------- Empty & loading -------------------------- */

/** A soft, unified empty state (item 8): one glyph, one line. */
export function EmptyState({ glyph, icon = INFO_ICON, title, hint }: { glyph?: string; icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <span aria-hidden style={{ color: 'var(--alice-muted)' }}>{glyph ? <span>{glyph}</span> : <SvgIcon svg={icon} size={20} />}</span>
      <span className="font-numbers" style={{ fontSize: 14, color: 'var(--alice-text)' }}>{title}</span>
      {hint && <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>{hint}</span>}
    </div>
  );
}

/** A shimmering placeholder block (item 9). */
export function Skeleton({ width = '100%', height = 14, style }: { width?: number | string; height?: number; style?: CSSProperties }) {
  return <div className="rh-skeleton" style={{ width, height, ...style }} aria-hidden />;
}

/** A few stacked skeleton lines, for a loading list/card. */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${100 - i * 12}%`} />
      ))}
    </div>
  );
}

/** A quiet "work in progress" row: pulsing dots and a label, for a section
 *  whose content is still being computed. The section itself stays in place,
 *  so a first-time user learns it exists before its data lands. */
export function Analyzing({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-3" aria-live="polite">
      <span aria-hidden className="flex items-center" style={{ gap: 3 }}>
        <span className="rh-dot" /><span className="rh-dot" /><span className="rh-dot" />
      </span>
      <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>{label}</span>
    </div>
  );
}

/** A titled panel whose body is swapped from skeleton to data in place: the
 *  frame (and the page layout) never moves while the content loads. */
export function SectionPanel({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col" style={{ borderTop: '1px solid var(--alice-border)', borderRadius: 'var(--alice-radius-control)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: 'transparent' }}>
        <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Copy is a separate control from following an address or transaction. */
export function ExplorerCopy({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2400);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <span className="inline-flex items-center gap-2 shrink-0">
      <button type="button" className="alice-control alice-control--tool"
        title={`Copy ${label}`} aria-label={`Copy ${label}`}
        onClick={async event => {
          event.stopPropagation();
          try { await navigator.clipboard.writeText(value); setState('copied'); }
          catch { setState('error'); }
        }}>
        <SvgIcon svg={state === 'copied' ? CHECK_ICON : COPY_ICON} size={16} />
      </button>
      <span className="font-numbers text-xs" role="status">
        {state === 'copied' ? 'Copied' : state === 'error' ? 'Copy unavailable' : ''}
      </span>
    </span>
  );
}

/** Keep Explorer dialogs keyboard-contained and return focus to their opener. */
export function useExplorerDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (!dialog) return;
    const selector = 'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]';
    const first = dialog.querySelector<HTMLElement>(selector);
    first?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
      const start = controls[0], end = controls[controls.length - 1];
      if (!start || !end) return;
      if (event.shiftKey && document.activeElement === start) { event.preventDefault(); end.focus(); }
      else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); start.focus(); }
    };
    dialog.addEventListener('keydown', handleKey);
    return () => { dialog.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, []);
  return ref;
}
