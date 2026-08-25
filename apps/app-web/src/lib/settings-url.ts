'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

/** Kept as a literal rather than imported from the tab registry: every entry
 *  point in the app calls this, and pulling the registry in would drag all the
 *  tab components into their bundles. The dialog validates the value anyway. */
const FALLBACK_TAB = 'general';

/**
 * Settings live in a query parameter on whatever route the user is already on,
 * so opening them never unmounts the chat or Explorer behind the dialog, and
 * the browser's back button closes them.
 */
export const SETTINGS_PARAM = 'settings';

function withParams(mutate: (params: URLSearchParams) => void): string {
  const params = new URLSearchParams(window.location.search);
  mutate(params);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

export function settingsHref(tab: string): string {
  return withParams(params => params.set(SETTINGS_PARAM, tab));
}

export function withoutSettingsHref(): string {
  return withParams(params => params.delete(SETTINGS_PARAM));
}

/**
 * Opens the settings dialog on the current route. Every entry point in the app
 * goes through this rather than navigating to /settings, so the view behind
 * stays mounted.
 */
export function useOpenSettings(): (tab?: string) => void {
  const router = useRouter();
  return useCallback(
    (tab: string = FALLBACK_TAB) => router.push(settingsHref(tab)),
    [router],
  );
}
