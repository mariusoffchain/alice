export const OPEN_WHATS_NEW_EVENT = 'alice-open-whats-new';
export function openWhatsNew() {
  window.dispatchEvent(new Event(OPEN_WHATS_NEW_EVENT));
}
