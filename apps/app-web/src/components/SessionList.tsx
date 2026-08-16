'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { type ChatSession, useChat } from '@alice-wallet/alice-ai';
import { hasSessionTabs, removeSessionTabs } from '@/lib/explorer/session-links';

const SESSION_PAGE_SIZE = 20;

interface SessionListProps {
  onClose: () => void;
}

export function SessionList({ onClose }: SessionListProps) {
  const { sessions, openSession, removeSession, refreshSessions } = useChat();
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  const [visibleCount, setVisibleCount] = useState(SESSION_PAGE_SIZE);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const sessionId = pendingDelete.id;
    setPendingDelete(null);
    await removeSession(sessionId);
    removeSessionTabs(sessionId);
  };

  // A session written from the Explorer sidebar carries its tabs: opening
  // it lands in Explorer with the exploration restored (the workspace does
  // the restoring; from here it only needs the navigation).
  const openFromHistory = async (session: ChatSession) => {
    await openSession(session.id);
    onClose();
    if (hasSessionTabs(session.id) && !pathname.startsWith('/explorer')) {
      router.push('/explorer');
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-5">
        <p
          className="font-pixel tracking-widest"
          style={{ fontSize: 8, color: 'var(--alice-text)' }}
        >
          NO PAST CONVERSATIONS
        </p>
      </div>
    );
  }

  const hasMoreSessions = visibleCount < sessions.length;

  return (
    <>
      <div
        className="flex-1 overflow-y-auto"
        onScroll={(event) => {
          const target = event.currentTarget;
          if (
            visibleCount < sessions.length
            && target.scrollHeight - target.scrollTop - target.clientHeight < 80
          ) {
            setVisibleCount(count => Math.min(count + SESSION_PAGE_SIZE, sessions.length));
          }
        }}
      >
        {sessions.slice(0, visibleCount).map((session) => (
          <div
            key={session.id}
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid rgba(22, 41, 74, 0.2)' }}
          >
            <button
              onClick={() => void openFromHistory(session)}
              className="flex-1 text-left cursor-pointer bg-transparent border-none outline-none"
            >
              <p
                className="font-numbers m-0"
                style={{ fontSize: 16, color: 'var(--alice-text)' }}
              >
                {session.title}
                {hasSessionTabs(session.id) && (
                  <span
                    className="font-pixel tracking-widest"
                    title="Opens in Explorer with its tabs"
                    style={{ fontSize: 6, marginLeft: 8, padding: '2px 5px', border: '1px solid var(--alice-primary)', borderRadius: 2, color: 'var(--alice-primary)', verticalAlign: 'middle' }}
                  >
                    EXPLORER
                  </span>
                )}
              </p>
              <p
                className="font-pixel tracking-widest m-0 mt-1"
                style={{ fontSize: 6, color: 'var(--alice-text)', opacity: 0.6 }}
              >
                {new Date(session.updatedAt).toLocaleDateString()} &middot;{' '}
                {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
              </p>
            </button>
            <button
              onClick={() => setPendingDelete(session)}
              className="w-8 h-8 flex items-center justify-center cursor-pointer bg-transparent border-none outline-none"
              style={{ color: 'var(--alice-text)', opacity: 0.5, fontSize: 18 }}
              aria-label="Delete session"
            >
              &times;
            </button>
          </div>
        ))}
        {hasMoreSessions ? (
          <button
            type="button"
            onClick={() => setVisibleCount(count => Math.min(
              count + SESSION_PAGE_SIZE,
              sessions.length,
            ))}
            className="font-pixel tracking-widest block mx-auto my-4 px-3 py-2 cursor-pointer bg-transparent border-none"
            style={{ fontSize: 6, color: 'var(--alice-text)', opacity: 0.65 }}
          >
            LOAD {Math.min(SESSION_PAGE_SIZE, sessions.length - visibleCount)} MORE
          </button>
        ) : sessions.length > SESSION_PAGE_SIZE ? (
          <p
            className="font-pixel tracking-widest text-center my-4"
            style={{ fontSize: 6, color: 'var(--alice-text)', opacity: 0.5 }}
          >
            {Math.min(visibleCount, sessions.length)} OF {sessions.length}
          </p>
        ) : null}
      </div>

      {pendingDelete && (
        <div
          className="fixed inset-0 flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }}
          onClick={() => setPendingDelete(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              padding: 16,
              backgroundColor: 'var(--alice-bg)',
              border: '2px solid var(--alice-border)',
              borderRadius: 2,
              color: 'var(--alice-text)',
            }}
          >
            <h3
              className="font-pixel tracking-widest m-0"
              style={{ fontSize: 9, color: 'var(--alice-primary-dark)' }}
            >
              DELETE CONVERSATION
            </h3>
            <p
              className="font-numbers m-0 mt-3"
              style={{ fontSize: 15, lineHeight: '20px', opacity: 0.8 }}
            >
              Delete "{pendingDelete.title}" from your history? This cannot be undone.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setPendingDelete(null)}
                className="font-pixel tracking-widest flex-1 cursor-pointer"
                style={{
                  fontSize: 7,
                  padding: '10px 12px',
                  border: '2px solid var(--alice-border)',
                  borderRadius: 2,
                  backgroundColor: 'transparent',
                  color: 'var(--alice-primary)',
                }}
              >
                CANCEL
              </button>
              <button
                onClick={() => void confirmDelete()}
                className="font-pixel tracking-widest flex-1 cursor-pointer"
                style={{
                  fontSize: 7,
                  padding: '10px 12px',
                  border: '2px solid #e06060',
                  borderRadius: 2,
                  backgroundColor: '#e06060',
                  color: '#ffffff',
                }}
              >
                DELETE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
