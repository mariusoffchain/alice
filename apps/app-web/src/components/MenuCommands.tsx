'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useChat } from '@alice-wallet/alice-ai';
import { requestSearch } from '@/lib/search-signal';

/**
 * Bridges the native desktop menu to the web layer.
 *
 * The macOS menu bar is global, so its commands have to work on every route.
 * This lives at the root rather than in Sidebar, which only mounts on the chat
 * page and left the menu inert on /settings.
 *
 * Rust dispatches `alice-menu` because a menu accelerator is swallowed by macOS
 * and never reaches the webview. On the web there is no menu, and the keyboard
 * shortcuts in Sidebar keep handling these actions directly.
 */
export function MenuCommands() {
  const router = useRouter();
  const pathname = usePathname();
  const { clearMessages } = useChat();

  useEffect(() => {
    const handler = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;

      if (action === 'settings') {
        router.push('/settings');
        return;
      }

      // New Chat and Search both act on the chat view, so triggering them from
      // Settings navigates back to it rather than doing nothing visible.
      if (action === 'new-chat') {
        clearMessages();
        if (pathname !== '/') router.push('/');
        return;
      }

      if (action === 'search') {
        requestSearch();
        if (pathname !== '/') router.push('/');
      }
    };

    window.addEventListener('alice-menu', handler);
    return () => window.removeEventListener('alice-menu', handler);
  }, [router, pathname, clearMessages]);

  return null;
}
