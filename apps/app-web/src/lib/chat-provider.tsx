'use client';

import { useEffect, useState } from 'react';
import {
  AccountProvider,
  ChatProvider,
  restoreDownloadedPacks,
  checkForPackUpdates,
  preloadSemanticSearch,
  KNOWLEDGE_PACK_CATALOG,
  type ChatStorageCipher,
} from '@alice-wallet/alice-ai';
import { MenuCommands } from '@/components/MenuCommands';
import { AccountPasswordDialog } from '@/components/AccountPasswordDialog';
import { initThemeFromStorage } from '@/lib/theme-init';
import { createTauriChatStorageCipher } from '@/lib/tauri-chat-storage-cipher';

export function ChatProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [storageCipher] = useState<ChatStorageCipher | undefined>(
    createTauriChatStorageCipher,
  );

  useEffect(() => {
    initThemeFromStorage();
    void restoreDownloadedPacks().then(() => {
      // Silent, throttled to once per day: only refreshes packs already
      // downloaded, never fetches anything new on its own.
      void checkForPackUpdates(KNOWLEDGE_PACK_CATALOG);
    });
    // Background download of the semantic search model (~118 MB, cached by
    // the browser afterwards). Never blocks chat: retrieval stays lexical
    // until this resolves. On for everyone by design — see project notes.
    preloadSemanticSearch();
  }, []);

  return (
    <AccountProvider>
      <ChatProvider storageCipher={storageCipher}>
        <MenuCommands />
        {children}
        <AccountPasswordDialog />
      </ChatProvider>
    </AccountProvider>
  );
}
