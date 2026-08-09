// The conversation search box is owned by Sidebar, which only mounts on the
// chat route. A Search command fired from /settings therefore has to survive a
// navigation: the request is parked here and consumed when the sidebar next
// mounts. When the sidebar is already mounted, the event path handles it.

const SEARCH_EVENT = 'alice-open-search';

let pending = false;

export function requestSearch(): void {
  pending = true;
  window.dispatchEvent(new Event(SEARCH_EVENT));
}

/** Returns whether a search was requested, and clears the request. */
export function consumeSearchRequest(): boolean {
  const requested = pending;
  pending = false;
  return requested;
}

export function onSearchRequest(handler: () => void): () => void {
  window.addEventListener(SEARCH_EVENT, handler);
  return () => window.removeEventListener(SEARCH_EVENT, handler);
}
