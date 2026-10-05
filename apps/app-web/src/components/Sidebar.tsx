'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ChatSession,
  useAccount,
  useChat,
  isTauriDesktop,
} from '@alice-wallet/alice-ai';
import { MENU_ICON, PLUS_ICON, EXPLORE_ICON, LEARN_ICON, PLAY_ICON, SEARCH_ICON, DELETE_ICON, CLOSE_ICON } from '@/lib/atelier-icons';
import { SvgIcon } from '@/components/SvgIcon';
import { ConfirmDialog } from '@/components/settings/ui';
import { FeedbackModal } from '@/components/FeedbackModal';
import { SidebarAccountMenu } from '@/components/SidebarAccountMenu';
import { useOpenSettings } from '@/lib/settings-url';
import { consumeSearchRequest, onSearchRequest } from '@/lib/search-signal';
import appWebPackage from '../../package.json';
import appDesktopPackage from '../../../app-desktop/package.json';

export const SIDEBAR_ICON_SVG = MENU_ICON;
const CHAT_ICON_SVG = PLUS_ICON;

const SEARCH_ICON_SVG = SEARCH_ICON;

const EXPLORER_ICON_SVG = EXPLORE_ICON;
const LEARN_ICON_SVG = LEARN_ICON;
const PLAYGROUND_ICON_SVG = PLAY_ICON;

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Below `md`, the sidebar leaves the flow entirely and becomes a full-screen
   *  drawer driven by this flag. A 260px column would leave too little room for
   *  the conversation on a phone. */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function MenuItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** The section currently on screen, shaded like the active chat entry. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="alice-nav-item alice-control alice-control--option flex items-center gap-3 w-full px-4 py-2.5"
      style={{ color: active ? 'var(--alice-selected)' : 'var(--alice-muted)', backgroundColor: 'transparent' }}
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0 opacity-100">
        {icon}
      </span>
      <span className="font-numbers text-sm flex-1 text-left">{label}</span>
    </button>
  );
}

const TITLEBAR_HEIGHT = 28;
const SESSION_PAGE_SIZE = 20;

const SIDEBAR_WIDTH_KEY = 'alice.sidebar.width';
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 420;

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { sessions, openSession, removeSession, refreshSessions, clearMessages, activeSessionId } = useChat();
  const account = useAccount();
  const openSettings = useOpenSettings();
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [visibleSessionCount, setVisibleSessionCount] = useState(SESSION_PAGE_SIZE);
  const [panelWidth, setPanelWidth] = useState(260);

  useEffect(() => {
    try {
      const w = parseInt(window.localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '', 10);
      if (Number.isFinite(w)) setPanelWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, w)));
    } catch { /* default width */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(panelWidth)); } catch { /* best effort */ }
  }, [panelWidth]);

  // Drag the panel's right edge to resize it (desktop only).
  function startPanelResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const move = (ev: PointerEvent) => {
      setPanelWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, startW + (ev.clientX - startX))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  useEffect(() => {
    setIsDesktop(isTauriDesktop());
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'n') {
        e.preventDefault();
        clearMessages();
        router.push('/');
      }
      if (e.metaKey && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
      if (e.metaKey && e.key === ',') {
        e.preventDefault();
        openSettings();
      }
      if (e.key === 'Escape' && mobileOpen) {
        onMobileClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearMessages, router, mobileOpen, onMobileClose, openSettings]);

  // The Search menu command is routed here by MenuCommands, which owns the
  // desktop menu bridge at the app root. Set rather than toggle: firing twice
  // must never close the search that was just opened.
  useEffect(() => {
    if (consumeSearchRequest()) setSearchOpen(true);
    return onSearchRequest(() => {
      consumeSearchRequest();
      setSearchOpen(true);
    });
  }, []);

  // On mobile the drawer covers the whole screen, so anything that changes what
  // is behind it has to dismiss it, otherwise the user acts blind.
  const closeIfMobile = useCallback(() => {
    if (mobileOpen) onMobileClose();
  }, [mobileOpen, onMobileClose]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const sessionId = pendingDelete.id;
    setPendingDelete(null);
    await removeSession(sessionId);
  };

  const version = isDesktop ? appDesktopPackage.version : appWebPackage.version;
  const accountName = account.account?.username
    ?? account.account?.display_name
    ?? null;
  // The quota is the one number an anonymous user cannot find anywhere else, so
  // it doubles as the subtitle when there is no email to show. On a paid plan
  // the request counter no longer exists; the estimated percentage takes over.
  const accountSubtitle = account.account?.email_masked
    ?? (account.cloudUsage
      ? account.cloudUsage.kind === 'paid'
        ? `${account.cloudUsage.percentUsed}% of monthly usage`
        : `${account.cloudUsage.remaining}/${account.cloudUsage.limit} cloud requests left`
      : null);

  const filteredSessions = searchQuery
    ? sessions.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions;
  const visibleSessions = filteredSessions.slice(0, visibleSessionCount);
  const hasMoreSessions = visibleSessions.length < filteredSessions.length;

  useEffect(() => {
    setVisibleSessionCount(SESSION_PAGE_SIZE);
  }, [searchQuery]);

  // The mobile drawer is always the full sidebar: the 48px icon rail is a
  // desktop-only affordance.
  if (collapsed && !mobileOpen) {
    return (
      <div
        className="alice-sidebar hidden md:flex flex-col items-center gap-1 shrink-0 h-full"
        style={{
          width: 48,
          position: 'relative',
          paddingTop: isDesktop ? TITLEBAR_HEIGHT + 12 : 12,
          paddingBottom: 12,
          backgroundColor: 'var(--alice-sidebar-bg, var(--alice-bg-soft))',
          borderRight: 'none',
        }}
      >
        {isDesktop && (
          <div
            data-tauri-drag-region
            style={{ position: 'absolute', top: 0, left: 0, width: 48, height: TITLEBAR_HEIGHT }}
          />
        )}
        <button
          onClick={onToggle}
          className="alice-control alice-control--tool"
          aria-label="Expand sidebar"
        >
          <SvgIcon svg={SIDEBAR_ICON_SVG} size={20} color="currentColor" />
        </button>
        <button
          onClick={() => { clearMessages(); router.push('/'); }}
          className="alice-control alice-control--tool"
          aria-label="New chat"
        >
          <SvgIcon svg={CHAT_ICON_SVG} size={20} color="currentColor" />
        </button>
        <button
          onClick={() => router.push('/explorer')}
          className="alice-control alice-control--tool"
          aria-label="Explorer"
        >
          <SvgIcon svg={EXPLORER_ICON_SVG} size={20} color="currentColor" />
        </button>
        <button
          onClick={() => { router.push('/learn'); window.dispatchEvent(new Event('alice-learn-reset')); }}
          className="alice-control alice-control--tool"
          aria-label="Learn"
        >
          <SvgIcon svg={LEARN_ICON_SVG} size={20} color="currentColor" />
        </button>
        <button
          onClick={() => router.push('/playground')}
          className="alice-control alice-control--tool"
          aria-label="Playground"
          aria-current={pathname.startsWith('/playground') ? 'page' : undefined}
        >
          <SvgIcon svg={PLAYGROUND_ICON_SVG} size={20} color="currentColor" />
        </button>
        <button
          onClick={() => { onToggle(); setSearchOpen(true); }}
          className="alice-control alice-control--tool"
          aria-label="Search"
        >
          <SvgIcon svg={SEARCH_ICON_SVG} size={16} color="currentColor" />
        </button>
        <SidebarAccountMenu
          collapsed
          username={accountName}
          subtitle={accountSubtitle}
          version={version}
          onSettings={() => openSettings()}
          onAccount={() => account.requestSignIn()}
          onReport={() => setFeedbackOpen(true)}
        />
        {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
      </div>
    );
  }

  return (
    <>
      <div
        data-mobile-open={mobileOpen || undefined}
        className={`alice-sidebar ${mobileOpen ? 'fixed inset-0 z-50 flex' : 'hidden md:flex'} md:relative md:z-auto flex-col shrink-0 h-full w-full md:w-[var(--sidebar-w,260px)]`}
        style={{
          ['--sidebar-w' as string]: `${panelWidth}px`,
          backgroundColor: 'var(--alice-sidebar-bg, var(--alice-bg-soft))',
          borderRight: 'none',
        } as React.CSSProperties}
      >
        <div
          onPointerDown={startPanelResize}
          className="hidden md:block absolute right-0 inset-y-0 z-10"
          style={{ width: 5, cursor: 'col-resize' }}
          aria-hidden="true"
        />
        {isDesktop && (
          <div
            data-tauri-drag-region
            className="shrink-0"
            style={{ height: TITLEBAR_HEIGHT }}
          />
        )}

        {/* Window drag area + collapse button */}
        <div
          className="flex items-center justify-between px-4 shrink-0 gap-2"
          style={{ height: 84 }}
        >
          <div className="flex items-center gap-2">

            <span className="font-pixel" style={{ fontSize: 11, lineHeight: '20px', color: 'var(--alice-text)' }}>
              ALICE
            </span>
          </div>
          <button
            onClick={mobileOpen ? onMobileClose : onToggle}
            className="alice-control alice-control--tool"
            aria-label={mobileOpen ? 'Close menu' : 'Collapse sidebar'}
          >
            <SvgIcon svg={mobileOpen ? CLOSE_ICON : SIDEBAR_ICON_SVG} size={20} color="currentColor" />
          </button>
        </div>

        {/* Menu items */}
        <div className="flex flex-col shrink-0">
          <MenuItem
            icon={<SvgIcon svg={CHAT_ICON_SVG} size={20} color="currentColor" />}
            label="New Chat"
            onClick={() => { clearMessages(); router.push('/'); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={EXPLORER_ICON_SVG} size={20} color="currentColor" />}
            label="Explorer"
            active={pathname.startsWith('/explorer')}
            onClick={() => { router.push('/explorer'); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={LEARN_ICON_SVG} size={20} color="currentColor" />}
            label="Learn"
            active={pathname.startsWith('/learn')}
            onClick={() => { router.push('/learn'); window.dispatchEvent(new Event('alice-learn-reset')); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={PLAYGROUND_ICON_SVG} size={20} color="currentColor" />}
            label="Playground"
            active={pathname.startsWith('/playground')}
            onClick={() => { router.push('/playground'); closeIfMobile(); }}
          />
        </div>

        {/* Chats section */}
        <div
          className="flex items-center justify-between gap-2 pl-4 pr-2 pt-4 pb-1 shrink-0"
          style={{ marginTop: 24 }}
        >
          <span
            className="font-numbers text-xs uppercase tracking-wider"
            style={{ color: 'var(--alice-muted)' }}
          >
            Chats
          </span>
          <button
            onClick={() => setSearchOpen(prev => !prev)}
            ref={searchTriggerRef}
            className="alice-control alice-control--tool shrink-0"
            style={{ opacity: 1 }}
            aria-label="Search conversations"
            aria-expanded={searchOpen}
            title="Search conversations (⌘ K)"
          >
            <SvgIcon svg={SEARCH_ICON_SVG} size={16} color="currentColor" />
          </button>
        </div>

        {/* Search input (toggled from the Chats header) */}
        {searchOpen && (
          <div className="px-3 pt-1 pb-2 shrink-0">
            <label htmlFor="sidebar-search" className="alice-field-label">Search conversations</label>
            <input
              id="sidebar-search"
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); searchTriggerRef.current?.focus(); }
              }}
              placeholder="Search conversations..."
              className="alice-field w-full font-numbers"
              style={{
                minHeight: 40,
                fontSize: 15,
                padding: '0 10px',
                color: 'var(--alice-text)',
                backgroundColor: 'var(--alice-bg)',
                border: '1px solid var(--alice-border)',
                borderRadius: 2,
              }}
            />
          </div>
        )}

        {/* Session list */}
        <div
          className="flex-1 overflow-y-auto px-1.5"
          onScroll={(event) => {
            const target = event.currentTarget;
            if (
              hasMoreSessions
              && target.scrollHeight - target.scrollTop - target.clientHeight < 80
            ) {
              setVisibleSessionCount(count => Math.min(
                count + SESSION_PAGE_SIZE,
                filteredSessions.length,
              ));
            }
          }}
        >
          {filteredSessions.length === 0 ? (
            <p
              className="font-numbers text-center mt-6 px-3"
              style={{ fontSize: 15, color: 'var(--alice-muted)', opacity: 1 }}
            >
              {searchQuery ? 'No results' : 'No conversations yet'}
            </p>
          ) : (
            visibleSessions.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  className="alice-session group flex items-center gap-1 rounded-sm mb-0.5"
                  style={{
                    backgroundColor: 'transparent',
                  }}
                >
                  <button
                    onClick={async () => {
                      await openSession(session.id);
                      // From Learn (or any non-chat page), opening a past
                      // conversation shows it in the full chat page. Explorer
                      // keeps its own behaviour: a linked session restores the
                      // exploration in place.
                      if (!window.location.pathname.startsWith('/explorer')
                        && window.location.pathname !== '/') {
                        router.push('/');
                      }
                      closeIfMobile();
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className="alice-control alice-control--option flex-1 text-left py-2 px-2.5 min-w-0"
                  >
                    <p
                      className="font-numbers m-0 truncate"
                      style={{
                        fontSize: 15,
                        lineHeight: '18px',
                        color: isActive ? 'var(--alice-selected)' : 'var(--alice-muted)',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {session.title}
                    </p>
                  </button>
                  <button
                    onClick={() => setPendingDelete(session)}
                    className="alice-control alice-control--tool alice-control--danger shrink-0 mr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 alice-session-delete"
                    style={{ color: 'var(--alice-muted)', fontSize: 16 }}
                    aria-label="Delete session"
                  >
                    <SvgIcon svg={DELETE_ICON} size={16} color="currentColor" />
                  </button>
                </div>
              );
            })
          )}
          {hasMoreSessions ? (
            <button
              type="button"
              onClick={() => setVisibleSessionCount(count => Math.min(
                count + SESSION_PAGE_SIZE,
                filteredSessions.length,
              ))}
              className="alice-control alice-control--quiet font-numbers mx-auto my-3"
              style={{ fontSize: 13, color: 'var(--alice-muted)', opacity: 1 }}
            >
              LOAD {Math.min(SESSION_PAGE_SIZE, filteredSessions.length - visibleSessions.length)} MORE
            </button>
          ) : filteredSessions.length > SESSION_PAGE_SIZE ? (
            <p
              className="font-numbers text-center my-3"
              style={{ fontSize: 13, color: 'var(--alice-muted)', opacity: 1 }}
            >
              {visibleSessions.length} OF {filteredSessions.length}
            </p>
          ) : null}
        </div>

        <SidebarAccountMenu
          collapsed={false}
          username={accountName}
          subtitle={accountSubtitle}
          version={version}
          onSettings={() => { openSettings(); closeIfMobile(); }}
          onAccount={() => { account.requestSignIn(); closeIfMobile(); }}
          onReport={() => { setFeedbackOpen(true); closeIfMobile(); }}
        />
      </div>

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}

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
