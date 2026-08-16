'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { Tab, TabKind } from '@/lib/explorer/tabs';
import { NETWORKS, getNetwork } from '@/lib/explorer/networks';

// A glyph per tab kind, so a tab's type is legible at a glance and not carried
// by colour alone (item 11 / item 5).
const TAB_GLYPH: Record<TabKind, string> = {
  overview: '⌂', tx: '⇄', address: '◈', block: '▦', xpub: '☰',
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
        className="flex items-center gap-1 shrink-0 cursor-pointer my-1"
        style={{
          padding: '5px 10px', borderRadius: 2,
          border: '1px solid var(--alice-border)', backgroundColor: 'var(--alice-bg-soft)',
        }}
        aria-label="Choose network"
        title={`Network: ${net.label}`}
      >
        <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-text)' }}>{net.label}</span>
        <span style={{ fontSize: 10, color: 'var(--alice-muted)' }}>▾</span>
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          className="fixed flex flex-col"
          style={{
            left: pos.left, top: pos.top, zIndex: 50, minWidth: 170,
            backgroundColor: 'var(--alice-bg)', border: '1px solid var(--alice-border)', borderRadius: 2,
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
          }}
        >
          {NETWORKS.map((n, i) => (
            <Fragment key={n.id}>
              {/* A labelled divider separates the test networks from the
                  production chains above them. */}
              {n.isTest && !NETWORKS[i - 1]?.isTest && (
                <div className="px-3 pt-2 pb-1" style={{ borderTop: '1px solid var(--alice-border)', marginTop: 4 }}>
                  <span className="font-pixel tracking-widest" style={{ fontSize: 6, color: 'var(--alice-muted)' }}>TEST NETWORKS</span>
                </div>
              )}
              <button
                type="button"
                disabled={!n.available}
                onClick={() => { if (n.available) { onSelectNetwork(n.id); setOpen(false); } }}
                className="flex items-center gap-2 text-left px-3 py-2 cursor-pointer disabled:cursor-not-allowed hover:bg-white/5 w-full"
                style={{ backgroundColor: n.id === activeNetworkId ? 'var(--alice-bg-soft)' : 'transparent', opacity: n.available ? 1 : 0.5 }}
                title={n.note}
              >
                <span style={{ width: 8, height: 8, borderRadius: 8, backgroundColor: n.color, flexShrink: 0 }} />
                <span className="font-numbers flex-1 min-w-0 truncate" style={{ fontSize: 13, color: n.id === activeNetworkId ? 'var(--alice-primary)' : 'var(--alice-text)' }}>{n.label}</span>
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
      className="flex items-stretch gap-1 overflow-x-auto shrink-0 px-2 pt-2"
      style={{ borderBottom: '1px solid var(--alice-border)' }}
    >
      <NetworkButton activeNetworkId={activeNetworkId} onSelectNetwork={onSelectNetwork} />

      {tabs.map((tab) => {
        const active = tab.id === activeId;
        // Home is permanent and network-neutral: it always wears the theme's
        // primary colour, never a network's. Every other tab wears its network.
        const isHome = tab.kind === 'overview';
        const color = isHome ? 'var(--alice-primary)' : getNetwork(tab.networkId).color;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className="group flex items-center gap-2 shrink-0 cursor-pointer"
            onClick={() => onSelect(tab.id)}
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
              // The accent colour shows on the top line only when the tab is
              // active; inactive tabs hide it to keep the bar calm.
              borderTop: `2px solid ${active ? color : 'transparent'}`,
              backgroundColor: active ? 'var(--alice-bg-soft)' : 'transparent',
              opacity: draggingId === tab.id ? 0.4 : 1,
              boxShadow: dropTargetId === tab.id && draggingId !== tab.id
                ? 'inset 2px 0 0 var(--alice-primary)'
                : undefined,
            }}
          >
            <span aria-hidden style={{ fontSize: 11, color: active ? color : 'var(--alice-muted)', lineHeight: 1 }}>
              {TAB_GLYPH[tab.kind]}
            </span>
            <span
              className="font-numbers truncate"
              style={{ fontSize: 13, color: active ? 'var(--alice-text)' : 'var(--alice-muted)' }}
              title={tab.query ?? tab.label}
            >
              {tab.label}
            </span>
            {/* Home cannot be closed; it is the fixed landing tab. */}
            {!isHome && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="shrink-0 cursor-pointer bg-transparent border-none outline-none"
                style={{ color: 'var(--alice-muted)', fontSize: 14, lineHeight: '14px' }}
                aria-label="Close tab"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
