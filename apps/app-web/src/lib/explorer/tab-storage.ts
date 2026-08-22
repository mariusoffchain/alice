// Persist the open Explorer tabs across navigations and reloads. The panel
// unmounts when the user opens a chat or another section, so without this every
// exploration would be lost on return. Stored in localStorage, best-effort: any
// failure just falls back to a fresh single Home tab.

import { DEFAULT_NETWORK_ID, getNetwork } from './networks.ts';
import { overviewTab, shortLabel, type Tab, type TabKind } from './tabs.ts';

const KEY = 'explorer.tabs.v1';
const KINDS: TabKind[] = ['overview', 'tx', 'address', 'block', 'xpub'];

function isValidTab(value: unknown): value is Tab {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === 'string' &&
    typeof t.label === 'string' &&
    typeof t.networkId === 'string' &&
    typeof t.bookmarked === 'boolean' &&
    typeof t.kind === 'string' &&
    KINDS.includes(t.kind as TabKind) &&
    (t.query === undefined || typeof t.query === 'string') &&
    // A tab whose network no longer exists is dropped rather than trusted.
    getNetwork(t.networkId).id === t.networkId
  );
}

export function loadTabs(): { tabs: Tab[]; activeId: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.tabs)) return null;
    const stored = obj.tabs.filter(isValidTab);
    if (stored.length === 0) return null;
    // The Home tab is permanent and always first: re-seed one if a legacy stored
    // set lacks it, and keep it at the head.
    const homes = stored.filter(t => t.kind === 'overview');
    const rest = stored.filter(t => t.kind !== 'overview');
    const home = homes[0] ?? overviewTab(DEFAULT_NETWORK_ID);
    const tabs = [home, ...rest];
    const activeId = typeof obj.activeId === 'string' && tabs.some(t => t.id === obj.activeId)
      ? obj.activeId
      : tabs[0].id;
    return { tabs, activeId };
  } catch {
    return null;
  }
}

export function saveTabs(tabs: Tab[], activeId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ tabs, activeId }));
  } catch {
    // Storage full or unavailable: persistence is a nicety, not essential.
  }
}

// One-shot deep-link channel: another surface (Learn's "See in the Explorer"
// anchors, the Playground's transactions) requests a subject to open, and the
// workspace consumes it on mount. Kept separate from the tab list itself so it
// never races the panel's own persistence.
const PENDING_KEY = 'explorer.pending-open.v1';
const OPENABLE: TabKind[] = ['tx', 'address', 'block', 'xpub'];

export interface PendingOpenNote {
  /** Human words for what the subject is ("Les 2 pizzas à 10 000 BTC"). */
  label: string;
  /** Where the visitor comes from ("Cours BTC101"), for the arrival banner. */
  origin: string;
}

export function requestPendingOpen(
  kind: Exclude<TabKind, 'overview'>,
  query: string,
  note?: PendingOpenNote,
  /** Network the subject lives on; omitted means the visitor's default. */
  networkId?: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ kind, query, note, networkId }));
  } catch {
    // Best-effort; the Explorer just opens on Home.
  }
}

/**
 * The same request, carried by the URL instead of storage: Alice Wallet links
 * a transaction or an address as `/explorer?tx=<id>&network=<id>` (also
 * `address=`, `block=`, `xpub=`), and nothing on the wallet side can write to
 * this origin's localStorage. A network the registry no longer knows falls
 * back to the visitor's default, like a stored request would.
 */
export function pendingOpenFromUrl(search: string): {
  kind: Exclude<TabKind, 'overview'>;
  query: string;
  note?: PendingOpenNote;
  networkId?: string;
} | null {
  const params = new URLSearchParams(search);
  for (const kind of OPENABLE) {
    const query = params.get(kind)?.trim();
    if (!query) continue;
    const network = params.get('network') ?? undefined;
    const networkId = network && getNetwork(network).id === network ? network : undefined;
    return {
      kind: kind as Exclude<TabKind, 'overview'>,
      query,
      note: { label: shortLabel(kind, query), origin: 'Alice Wallet' },
      networkId,
    };
  }
  return null;
}

export function consumePendingOpen(): {
  kind: Exclude<TabKind, 'overview'>;
  query: string;
  note?: PendingOpenNote;
  networkId?: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(PENDING_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.kind !== 'string' || typeof p.query !== 'string' || !p.query) return null;
    if (!OPENABLE.includes(p.kind as TabKind)) return null;
    const rawNote = p.note as Record<string, unknown> | undefined;
    const note =
      rawNote && typeof rawNote.label === 'string' && typeof rawNote.origin === 'string'
        ? { label: rawNote.label, origin: rawNote.origin }
        : undefined;
    // A network id read back from storage is only honoured if the registry
    // still knows it: a link kept from before a network was retired must fall
    // back to the visitor's default rather than open a tab on nothing.
    const networkId =
      typeof p.networkId === 'string' && getNetwork(p.networkId).id === p.networkId
        ? p.networkId
        : undefined;
    return {
      kind: p.kind as Exclude<TabKind, 'overview'>,
      query: p.query,
      note,
      networkId,
    };
  } catch {
    return null;
  }
}
