// The tab model for Explorer's browser-like workspace. Each exploration
// (a transaction, an address, a block, an xpub) is a tab. `overview` is the
// home tab with the search and, later, the live block ribbon.
//
// Pure data and helpers only: no React, no storage. The panel owns the array.

export type TabKind = 'overview' | 'tx' | 'address' | 'block' | 'xpub';

export type Tab = {
  id: string;
  kind: TabKind;
  /** The subject being explored: txid, address, block height/hash, xpub. Absent for overview. */
  query?: string;
  /** Short text shown on the tab. */
  label: string;
  /** A bookmarked tab is meant to survive a reload; a plain tab is disposable. */
  bookmarked: boolean;
  /** The network this tab belongs to; a tab keeps its network for life, so tabs
   *  from different networks coexist and switching network never clears them. */
  networkId: string;
};

function newId(): string {
  // crypto.randomUUID exists in every browser and the Tauri webview.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** A short, human label for a subject, so tabs stay narrow. */
export function shortLabel(kind: TabKind, query?: string): string {
  if (!query) return 'Home';
  if (kind === 'block') return /^\d+$/.test(query) ? `Block ${query}` : `Block ${query.slice(0, 8)}...`;
  if (query.length <= 14) return query;
  return `${query.slice(0, 6)}...${query.slice(-4)}`;
}

export function overviewTab(networkId: string): Tab {
  return { id: newId(), kind: 'overview', label: 'Home', bookmarked: false, networkId };
}

export function makeTab(kind: TabKind, query: string, networkId: string): Tab {
  return { id: newId(), kind, query, label: shortLabel(kind, query), bookmarked: false, networkId };
}

/** Insert a tab after the active one and return the new list plus its id. */
export function addTab(tabs: Tab[], tab: Tab, afterId: string): Tab[] {
  const idx = tabs.findIndex(t => t.id === afterId);
  if (idx === -1) return [...tabs, tab];
  return [...tabs.slice(0, idx + 1), tab, ...tabs.slice(idx + 1)];
}

/** Remove a tab; never leaves the workspace empty (re-seeds a home on the given
 *  network). */
export function closeTab(tabs: Tab[], id: string, seedNetworkId: string): { tabs: Tab[]; fallbackId: string } {
  const idx = tabs.findIndex(t => t.id === id);
  const remaining = tabs.filter(t => t.id !== id);
  if (remaining.length === 0) {
    const seed = overviewTab(seedNetworkId);
    return { tabs: [seed], fallbackId: seed.id };
  }
  // Focus the neighbour that took the closed tab's place, else the last one.
  const fallback = remaining[Math.min(idx, remaining.length - 1)];
  return { tabs: remaining, fallbackId: fallback.id };
}
