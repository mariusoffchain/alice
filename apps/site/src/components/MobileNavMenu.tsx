'use client';

import { useEffect, useRef, useState } from 'react';
import { NAV_LINKS } from '@/lib/site';
import { DOWNLOAD_GROUPS, PlatformRow } from '@/components/AppCtas';

/**
 * The phone nav: one button, everything inside. On small screens the nav
 * links and both CTA dropdowns have no room, so instead of picking a survivor
 * the whole navigation folds into this panel: page links first, then the
 * Alice App and Alice Wallet platform lists that the desktop dropdowns show.
 */
export function MobileNavMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
    <div ref={rootRef} className="md:hidden">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        onClick={() => setOpen(value => !value)}
        className="cta cta-mobile cursor-pointer px-3.5 py-1.5 text-sm"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
          <rect x="1" y="2.5" width="14" height="2" fill="currentColor" />
          <rect x="1" y="7" width="14" height="2" fill="currentColor" />
          <rect x="1" y="11.5" width="14" height="2" fill="currentColor" />
        </svg>
        Menu
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-[70] px-3 pt-2">
          <div
            role="menu"
            className="max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-[6px] border-2 border-[var(--alice-border)] bg-[var(--alice-bg-soft)] p-2 shadow-xl"
          >
            <nav aria-label="Pages" className="flex flex-col" onClick={() => setOpen(false)}>
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-[3px] px-3 py-2.5 text-[15px] font-semibold text-[var(--alice-heading)] transition-colors hover:bg-[var(--alice-bg)]"
                >
                  {link.label}
                </a>
              ))}
            </nav>

            {/* Same groups as the desktop Download menu, from one source, so
                the two surfaces cannot drift apart, and in two columns here
                too so the two products never read as one long list. */}
            <div className="mt-2 grid grid-cols-2 gap-1 border-t border-[var(--alice-border)] pt-2">
              {DOWNLOAD_GROUPS.map((group, i) => (
                <div key={group.label} className={i > 0 ? 'border-l border-[var(--alice-border)] pl-1' : ''}>
                  <div className="px-2 pb-1 pt-1">
                    <span className="font-pixel text-[9px] uppercase tracking-widest text-[var(--alice-muted)]">
                      {group.label}
                    </span>
                    {group.note && (
                      <p className="mt-1 text-[10px] leading-[1.35] text-[var(--alice-muted)]">
                        {group.note}
                      </p>
                    )}
                  </div>
                  {group.items.map((item) => (
                    <PlatformRow key={`${group.label}:${item.label}`} {...item} compact />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
