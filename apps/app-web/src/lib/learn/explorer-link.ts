import type { LearnExplorerAnchor } from '@alice-wallet/alice-content/src/learn-anchors';
import { requestPendingOpen } from '@/lib/explorer/tab-storage';

// Opening a course anchor in the Explorer goes through the one-shot
// pending-open channel, consumed by the Explorer workspace on mount. Writing
// the tab list directly would race the panel's own persistence (double-mount
// in dev, save-on-first-render); the dedicated channel cannot.
export function openAnchorInExplorer(
  anchor: LearnExplorerAnchor,
  lang: 'fr' | 'en',
  courseCode: string,
  navigate: (path: string) => void,
): void {
  requestPendingOpen(anchor.type, anchor.id, {
    label: anchor.label[lang],
    origin: lang === 'fr' ? `Cours ${courseCode.toUpperCase()}` : `Course ${courseCode.toUpperCase()}`,
  });
  navigate('/explorer');
}

/** Same channel for the chat's "Pour aller plus loin" rows. */
export function openAnchorFromChat(
  anchor: LearnExplorerAnchor,
  lang: 'fr' | 'en',
  navigate: (path: string) => void,
): void {
  requestPendingOpen(anchor.type, anchor.id, {
    label: anchor.label[lang],
    origin: lang === 'fr' ? 'Depuis le chat' : 'From the chat',
  });
  navigate('/explorer');
}
