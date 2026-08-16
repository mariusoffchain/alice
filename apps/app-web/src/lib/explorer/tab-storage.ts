// Persist the open Explorer tabs across navigations and reloads. The panel
// unmounts when the user opens a chat or another section, so without this every
// exploration would be lost on return. Stored in localStorage, best-effort: any
// failure just falls back to a fresh single Home tab.

import { DEFAULT_NETWORK_ID, getNetwork } from './networks.ts';
import { overviewTab, type Tab, type TabKind } from './tabs.ts';

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
