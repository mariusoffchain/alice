'use client';

import { useEffect, useState } from 'react';
import {
  type ChatCleanupMode,
  type ChatStorageSummary,
  isTauriDesktop,
  useChat,
  MAX_CHAT_SESSIONS,
} from '@alice-wallet/alice-ai';
import { ConfirmDialog, SectionLabel, sectionStyle } from './ui';
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
          <span className="font-numbers" style={{ fontSize: 13 }}>
            {count} / {MAX_CHAT_SESSIONS} CONVERSATIONS
          </span>
          <span className="font-numbers" style={{ fontSize: 13, opacity: 1 }}>
            {formatStorageSize(chatStorage?.estimatedBytes ?? 0)}
          </span>
        </div>
        <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, lineHeight: '19px', opacity: 1 }}>
          Conversations stay on this device. Alice keeps at most {MAX_CHAT_SESSIONS} and removes the oldest when the limit is reached.
        </p>
        <p className="font-numbers  m-0 mt-2" style={{ fontSize: 13, color: 'var(--alice-primary-dark)' }}>
          {isTauriDesktop()
            ? 'ENCRYPTED WITH THIS DEVICE’S SYSTEM KEYCHAIN'
            : 'STORED LOCALLY IN THIS BROWSER'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
          <button
            onClick={() => setConfirmChatCleanup('oldest-10')}
            className="alice-control alice-control--quiet font-numbers"
            disabled={count === 0 || cleaningChat}
          >
            DELETE 10 OLDEST
          </button>
          <button
            onClick={() => setConfirmChatCleanup('keep-newest-10')}
            className="alice-control alice-control--quiet font-numbers"
            disabled={count <= 10 || cleaningChat}
          >
            KEEP 10 NEWEST
          </button>
          <button
            onClick={() => setConfirmChatCleanup('all')}
            className="alice-control alice-control--danger font-numbers"
            disabled={count === 0 || cleaningChat}
          >
            DELETE ALL
          </button>
        </div>
        {cleanupNotice && (
          <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, opacity: 1 }}>
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
