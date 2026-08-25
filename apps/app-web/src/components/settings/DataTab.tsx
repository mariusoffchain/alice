'use client';

import { useEffect, useState } from 'react';
import {
  type ChatCleanupMode,
  type ChatStorageSummary,
  isTauriDesktop,
  useChat,
  MAX_CHAT_SESSIONS,
} from '@alice-wallet/alice-ai';
import { btnBase, ConfirmDialog, DANGER, SectionLabel, sectionStyle } from './ui';
import { LearnLanguagesSection } from './LearnLanguagesSection';

function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataTab() {
  const chat = useChat();
  const [chatStorage, setChatStorage] = useState<ChatStorageSummary | null>(null);
  const [confirmChatCleanup, setConfirmChatCleanup] = useState<ChatCleanupMode | null>(null);
  const [cleaningChat, setCleaningChat] = useState(false);
  const [cleanupNotice, setCleanupNotice] = useState('');

  useEffect(() => {
    chat.getSessionStorageSummary()
      .then(setChatStorage)
      .catch(() => { /* the counters simply stay at zero */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChatCleanup = async (mode: ChatCleanupMode) => {
    setCleaningChat(true);
    setCleanupNotice('');
    try {
      const result = await chat.cleanSessionHistory(mode);
      setChatStorage(await chat.getSessionStorageSummary());
      setCleanupNotice(
        `${result.deletedCount} conversation${result.deletedCount === 1 ? '' : 's'} deleted.`,
      );
    } catch (error) {
      console.warn('[settings] chat cleanup failed:', error);
      setCleanupNotice('Unable to clean discussion history.');
    } finally {
      setCleaningChat(false);
      setConfirmChatCleanup(null);
    }
  };

  const count = chatStorage?.count ?? 0;
  const chatCleanupCount = confirmChatCleanup === 'all'
    ? count
    : confirmChatCleanup === 'oldest-10'
      ? Math.min(10, count)
      : Math.max(0, count - 10);

  return (
    <>
      <div style={sectionStyle}>
        <SectionLabel>CLEAN YOUR DISCUSSION HISTORY</SectionLabel>
        <div className="flex items-center justify-between gap-3 mt-2">
          <span className="font-pixel tracking-widest" style={{ fontSize: 10 }}>
            {count} / {MAX_CHAT_SESSIONS} CONVERSATIONS
          </span>
          <span className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.55 }}>
            {formatStorageSize(chatStorage?.estimatedBytes ?? 0)}
          </span>
        </div>
        <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, lineHeight: '19px', opacity: 0.65 }}>
          Conversations stay on this device. Alice keeps at most {MAX_CHAT_SESSIONS} and removes the oldest when the limit is reached.
        </p>
        <p className="font-pixel tracking-widest m-0 mt-2" style={{ fontSize: 10, color: 'var(--alice-primary-dark)' }}>
          {isTauriDesktop()
            ? 'ENCRYPTED WITH THIS DEVICE’S SYSTEM KEYCHAIN'
            : 'STORED LOCALLY IN THIS BROWSER'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
          <button
            onClick={() => setConfirmChatCleanup('oldest-10')}
            className="font-pixel tracking-widest"
            style={{
              ...btnBase,
              backgroundColor: 'transparent',
              color: 'var(--alice-primary)',
              opacity: count === 0 ? 0.4 : 1,
            }}
            disabled={count === 0 || cleaningChat}
          >
            DELETE 10 OLDEST
          </button>
          <button
            onClick={() => setConfirmChatCleanup('keep-newest-10')}
            className="font-pixel tracking-widest"
            style={{
              ...btnBase,
              backgroundColor: 'transparent',
              color: 'var(--alice-primary)',
              opacity: count <= 10 ? 0.4 : 1,
            }}
            disabled={count <= 10 || cleaningChat}
          >
            KEEP 10 NEWEST
          </button>
          <button
            onClick={() => setConfirmChatCleanup('all')}
            className="font-pixel tracking-widest"
            style={{
              ...btnBase,
              backgroundColor: 'transparent',
              color: DANGER,
              borderColor: DANGER,
              opacity: count === 0 ? 0.4 : 1,
            }}
            disabled={count === 0 || cleaningChat}
          >
            DELETE ALL
          </button>
        </div>
        {cleanupNotice && (
          <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, opacity: 0.7 }}>
            {cleanupNotice}
          </p>
        )}
      </div>

      <LearnLanguagesSection />

      {confirmChatCleanup && (
        <ConfirmDialog
          title="DELETE CONVERSATIONS"
          body={`Delete ${chatCleanupCount} conversation${chatCleanupCount === 1 ? '' : 's'} from this device? This cannot be undone.`}
          confirmLabel={cleaningChat ? 'DELETING...' : 'DELETE'}
          busy={cleaningChat}
          onCancel={() => setConfirmChatCleanup(null)}
          onConfirm={() => void handleChatCleanup(confirmChatCleanup)}
        />
      )}
    </>
  );
}
