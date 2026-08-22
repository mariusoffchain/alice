'use client';

import { Suspense, useEffect, useState } from 'react';
import {
  AccountProvider,
  ChatProvider,
  loadRagCorpus,
  restoreDownloadedPacks,
  checkForPackUpdates,
  KNOWLEDGE_PACK_CATALOG,
  type ChatStorageCipher,
} from '@alice-wallet/alice-ai';
import { AppUpdateNotices } from '@/components/AppUpdateNotices';
import { MenuCommands } from '@/components/MenuCommands';
import { ModelDownloadToasts } from '@/components/ModelDownloadToasts';
import { AccountPasswordDialog } from '@/components/AccountPasswordDialog';
import { PaymentConfirmedDialog } from '@/components/PaymentConfirmedDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { initThemeFromStorage } from '@/lib/theme-init';
import { registerLearnTurnContext } from '@/lib/learn/turn-context';
import { createTauriChatStorageCipher } from '@/lib/tauri-chat-storage-cipher';

export function ChatProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const [storageCipher] = useState<ChatStorageCipher | undefined>(
    createTauriChatStorageCipher,
  );
  // Desktop and web have the headroom to load the corpus right away, so the
  // first question never waits for it.
  useEffect(() => { void loadRagCorpus(); }, []);

  useEffect(() => {
    initThemeFromStorage();
    // When a question points at a course, its chapter joins the turn context
    // (local model included: the pack is on this device).
    registerLearnTurnContext();
    void restoreDownloadedPacks().then(() => {
      // Silent, throttled to once per day: only refreshes packs already
      // downloaded, never fetches anything new on its own.
      void checkForPackUpdates(KNOWLEDGE_PACK_CATALOG);
    });
    // The semantic search model (~150 MB) is deliberately NOT preloaded here:
    // its download starts on the first question (rag.ts asks the runtime),
    // never on a data-saving connection, and Settings › AI can force or
    // remove it. Retrieval stays lexical until the model is ready.
  }, []);

  return (
    <AccountProvider>
      <ChatProvider storageCipher={storageCipher}>
        <MenuCommands />
        <ModelDownloadToasts />
        <AppUpdateNotices />
        {children}
        {/* useSearchParams needs a boundary so the rest of the tree can still
            be prerendered. */}
        <Suspense fallback={null}>
          <SettingsDialog />
        </Suspense>
        <AccountPasswordDialog />
        {/* Above the account dialog: a settled payment can land at any moment,
            wherever the user happens to be. */}
        <PaymentConfirmedDialog />
      </ChatProvider>
    </AccountProvider>
  );
}
