'use client';

// The "Ask Alice" opener: an Alice bubble fixed to the bottom-right of the
// viewport (it never scrolls with the page). It only opens the persistent
// Ask-Alice sidebar owned by the Explorer workspace; it renders nothing
// else and disappears while the sidebar is open.

import { AskAliceIcon } from '@/components/AskAliceIcon';

export function ExplorerAskFab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Ask Alice"
      className="fixed z-40 flex items-center justify-center cursor-pointer"
      style={{
        right: 16,
        bottom: 16,
        width: 48,
        height: 48,
        border: 'none',
        padding: 0,
        backgroundColor: 'transparent',
        opacity: 0.92,
      }}
    >
      <AskAliceIcon size={48} />
    </button>
  );
}
