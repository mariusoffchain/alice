'use client';

import { useEffect, useState } from 'react';
import { SvgIcon } from '@/components/SvgIcon';
import { DELETE_ICON } from '@/lib/atelier-icons';
import { ConfirmDialog } from '@/components/settings/ui';
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
          className="font-numbers"
          style={{ fontSize: 13, color: 'var(--alice-text)' }}
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
            style={{ borderBottom: '1px solid var(--alice-border)' }}
          >
            <button
              onClick={() => void openFromHistory(session)}
              className="alice-control alice-control--option flex-1 min-w-0 flex-col items-start text-left"
            >
              <p
                className="font-numbers m-0"
                style={{ fontSize: 16, color: 'var(--alice-text)' }}
              >
                {session.title}
                {hasSessionTabs(session.id) && (
                  <span
                    className="font-numbers"
                    title="Opens in Explorer with its tabs"
                    style={{ fontSize: 13, marginLeft: 8, padding: '2px 5px', border: '1px solid var(--alice-primary)', borderRadius: 2, color: 'var(--alice-primary)', verticalAlign: 'middle' }}
                  >
                    EXPLORER
                  </span>
                )}
              </p>
              <p
                className="font-numbers m-0 mt-1"
                style={{ fontSize: 13, color: 'var(--alice-text)', opacity: 1 }}
              >
                {new Date(session.updatedAt).toLocaleDateString()} &middot;{' '}
                {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
              </p>
            </button>
            <button
              onClick={() => setPendingDelete(session)}
              className="alice-control alice-control--tool alice-control--danger shrink-0"

              aria-label="Delete session"
            >
              <SvgIcon svg={DELETE_ICON} size={16} color="currentColor" />
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
            className="alice-control alice-control--quiet font-numbers mx-auto my-4"
            style={{ fontSize: 13, color: 'var(--alice-text)', opacity: 15 }}
          >
            LOAD {Math.min(SESSION_PAGE_SIZE, sessions.length - visibleCount)} MORE
          </button>
        ) : sessions.length > SESSION_PAGE_SIZE ? (
          <p
            className="font-numbers text-center my-4"
            style={{ fontSize: 13, color: 'var(--alice-text)', opacity: 1 }}
          >
            {Math.min(visibleCount, sessions.length)} OF {sessions.length}
          </p>
        ) : null}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="DELETE CONVERSATION"
          body={`Delete “${pendingDelete.title}” from your history? This cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </>
  );
}
