// Links a chat session to the Explorer tabs that were open while it was
// written, so opening the conversation from history can restore the whole
// exploration (the tabs) next to the chat. Stored in localStorage, best
// effort, entirely on this device: a missing or corrupt entry just means the
// session opens without tabs.

import type { Tab } from './tabs.ts';

const KEY = 'explorer.session-tabs.v1';
const MAX_ENTRIES = 60;

type Entry = { tabs: Tab[]; activeId: string; at: number };

function loadAll(): Record<string, Entry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, Entry>;
  } catch {
    return {};
  }
}

function persist(all: Record<string, Entry>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable: the link is a nicety, not essential.
  }
}

export function getSessionTabs(sessionId: string): { tabs: Tab[]; activeId: string } | null {
  const entry = loadAll()[sessionId];
  if (!entry || !Array.isArray(entry.tabs) || entry.tabs.length === 0) return null;
  return { tabs: entry.tabs, activeId: entry.activeId };
}

export function hasSessionTabs(sessionId: string): boolean {
  return getSessionTabs(sessionId) !== null;
}

export function saveSessionTabs(sessionId: string, tabs: Tab[], activeId: string): void {
  const all = loadAll();
  all[sessionId] = { tabs, activeId, at: Date.now() };
  const ids = Object.keys(all);
  if (ids.length > MAX_ENTRIES) {
    ids
      .sort((a, b) => (all[a].at ?? 0) - (all[b].at ?? 0))
      .slice(0, ids.length - MAX_ENTRIES)
      .forEach(id => { delete all[id]; });
  }
  persist(all);
}

export function removeSessionTabs(sessionId: string): void {
  const all = loadAll();
  if (!(sessionId in all)) return;
  delete all[sessionId];
  persist(all);
}
