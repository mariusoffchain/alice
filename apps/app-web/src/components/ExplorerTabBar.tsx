'use client';

import { SvgIcon } from '@/components/SvgIcon';
import { EXPLORE_ICON, NETWORK_ICON, WALLET_ICON, DATA_ICON, CLOSE_ICON, CHEVRON_DOWN_ICON, CHECK_ICON } from '@/lib/atelier-icons';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { Tab, TabKind } from '@/lib/explorer/tabs';
import { NETWORKS, getNetwork } from '@/lib/explorer/networks';

// A glyph per tab kind, so a tab's type is legible at a glance and not carried
// by colour alone (item 11 / item 5).
const TAB_GLYPH: Record<TabKind, string> = {
  overview: EXPLORE_ICON, tx: NETWORK_ICON, address: WALLET_ICON, block: DATA_ICON, xpub: WALLET_ICON,
};

// Standalone network button: it only opens the explorer dropdown, it is not a
// tab. It shows the active tab's network. Picking a network focuses (or opens)
// that network's home, leaving every other tab in place.
function NetworkButton({
  activeNetworkId,
  onSelectNetwork,
}: {
  activeNetworkId: string;
  onSelectNetwork: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const net = getNetwork(activeNetworkId);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    // Defer binding one tick so the opening click cannot immediately close it.
    const id = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => { clearTimeout(id); document.removeEventListener('click', onDocClick); };
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 2 });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        className="alice-control alice-control--quiet flex items-center gap-1 shrink-0 cursor-pointer my-1"
        style={{
          padding: '5px 10px', borderRadius: 'var(--alice-radius-control)',
          }}
        aria-label="Choose network"
        aria-expanded={open}
        aria-controls="explorer-network-menu"
        title={`Network: ${net.label}`}
      >
        <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-text)' }}>{net.label}</span>
        <SvgIcon svg={CHEVRON_DOWN_ICON} size={16} />
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          id="explorer-network-menu"
          onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } }}
          className="fixed flex flex-col"
          style={{
            left: pos.left, top: pos.top, zIndex: 50, minWidth: 170,
            backgroundColor: 'var(--alice-bg)', border: '1px solid var(--alice-border)', borderRadius: 'var(--alice-radius-control)',
            boxShadow: '0 2px 0 var(--alice-border)',
          }}
        >
          {NETWORKS.map((n, i) => (
            <Fragment key={n.id}>
              {/* A labelled divider separates the test networks from the
                  production chains above them. */}
              {n.isTest && !NETWORKS[i - 1]?.isTest && (
                <div className="px-3 pt-2 pb-1" style={{ borderTop: '1px solid var(--alice-border)', marginTop: 4 }}>
                  <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>TEST NETWORKS</span>
                </div>
              )}
              <button
                type="button"
                disabled={!n.available}
                onClick={() => { if (n.available) { onSelectNetwork(n.id); setOpen(false); btnRef.current?.focus(); } }}
                className="alice-control alice-control--option flex items-center gap-2 text-left px-3 py-2 cursor-pointer disabled:cursor-not-allowed  w-full"
                aria-pressed={n.id === activeNetworkId}
                style={{ opacity: n.available ? 1 : 0.5 }}
                title={n.note}
              >
                <span style={{ width: 8, height: 8, borderRadius: 1, backgroundColor: n.color, flexShrink: 0 }} />
                <span className="font-numbers flex-1 min-w-0 truncate" style={{ fontSize: 13, color: n.id === activeNetworkId ? 'var(--alice-primary)' : 'var(--alice-text)' }}>{n.label}</span>
                {n.id === activeNetworkId && <SvgIcon svg={CHECK_ICON} size={16} />}
                {!n.available && <span className="font-numbers" style={{ fontSize: 9, color: 'var(--alice-muted)' }}>soon</span>}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}

export function ExplorerTabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  activeNetworkId,
  onSelectNetwork,
}: {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Drop tab `fromId` at the position of tab `toId` (Home never moves). */
  onReorder?: (fromId: string, toId: string) => void;
  activeNetworkId: string;
  onSelectNetwork: (id: string) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  return (
    <div
      className="flex items-stretch gap-2 overflow-x-auto shrink-0 px-4 pt-2"
      style={{ borderBottom: '1px solid var(--alice-border)' }}
    >
      <NetworkButton activeNetworkId={activeNetworkId} onSelectNetwork={onSelectNetwork} />

      {tabs.map((tab) => {
        const active = tab.id === activeId;
        // Network identity stays in the selector; tab selection is neutral.
        const isHome = tab.kind === 'overview';
        const color = 'var(--alice-selected)';
        return (
          <div
            key={tab.id}
            role="group"
            className="group flex items-center gap-2 shrink-0 cursor-pointer"
            // Tabs reorder by drag and drop; Home stays put, but dropping ON
            // it is allowed and lands just after it.
            draggable={!isHome && !!onReorder}
            onDragStart={(e) => {
              if (isHome) return;
              e.dataTransfer.effectAllowed = 'move';
              setDraggingId(tab.id);
            }}
            onDragEnd={() => { setDraggingId(null); setDropTargetId(null); }}
            onDragOver={(e) => {
              if (!draggingId || draggingId === tab.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropTargetId(tab.id);
            }}
            onDragLeave={() => setDropTargetId(d => (d === tab.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingId && draggingId !== tab.id) onReorder?.(draggingId, tab.id);
              setDraggingId(null);
              setDropTargetId(null);
            }}
            style={{
              padding: '7px 10px',
              maxWidth: 200,
              borderRadius: '3px 3px 0 0',
              // A neutral underline marks selection without a filled tile.
              borderBottom: `2px solid ${active ? color : 'transparent'}`,
              backgroundColor: 'transparent',
              opacity: draggingId === tab.id ? 0.4 : 1,
              boxShadow: dropTargetId === tab.id && draggingId !== tab.id
                ? 'inset 2px 0 0 var(--alice-primary)'
                : undefined,
            }}
          >
            <button type="button" onClick={() => onSelect(tab.id)} aria-pressed={active}
              className="alice-control alice-control--quiet flex items-center gap-2 min-w-0 cursor-pointer" style={{ minHeight: 32, padding: '4px 0', flexShrink: 1 }}>
            <span aria-hidden style={{ fontSize: 11, color: active ? color : 'var(--alice-muted)', lineHeight: 1 }}>
              <SvgIcon svg={TAB_GLYPH[tab.kind]} size={20} />
            </span>
            <span
              className="font-numbers truncate"
              style={{ fontSize: 13, color: active ? 'var(--alice-text)' : 'var(--alice-muted)' }}
              title={tab.query ?? tab.label}
            >
              {tab.label}
            </span>
            </button>
            {/* Home cannot be closed; it is the fixed landing tab. */}
            {!isHome && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="alice-control alice-control--tool shrink-0 cursor-pointer bg-transparent border-none "
                style={{ color: 'var(--alice-muted)', fontSize: 14, lineHeight: '14px' }}
                aria-label={`Close ${tab.label} tab`}
              >
                <SvgIcon svg={CLOSE_ICON} size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
