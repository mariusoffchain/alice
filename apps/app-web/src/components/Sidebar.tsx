'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ChatSession,
  useAccount,
  useChat,
  isTauriDesktop,
} from '@alice-wallet/alice-ai';
import { NEW_CHAT_ICON_SVG } from '@alice-wallet/alice-ui/components/new-chat-icon-svg';
import { SvgIcon } from '@/components/SvgIcon';
import { AliceLogo } from '@/components/AliceLogo';
import { FeedbackModal } from '@/components/FeedbackModal';
import { SidebarAccountMenu } from '@/components/SidebarAccountMenu';
import { useOpenSettings } from '@/lib/settings-url';
import { consumeSearchRequest, onSearchRequest } from '@/lib/search-signal';
import appWebPackage from '../../package.json';
import appDesktopPackage from '../../../app-desktop/package.json';

export const SIDEBAR_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="1" y="1" width="14" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="13" width="14" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="3" width="2" height="10" fill="{{COLOR}}"/>
  <rect x="13" y="3" width="2" height="10" fill="{{COLOR}}"/>
  <rect x="5" y="3" width="2" height="10" fill="{{COLOR}}"/>
</svg>`;

const CHAT_ICON_SVG = NEW_CHAT_ICON_SVG;

const SEARCH_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="4" y="1" width="4" height="2" fill="{{COLOR}}"/>
  <rect x="2" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="8" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="5" width="2" height="4" fill="{{COLOR}}"/>
  <rect x="9" y="5" width="2" height="4" fill="{{COLOR}}"/>
  <rect x="2" y="9" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="8" y="9" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="4" y="11" width="4" height="2" fill="{{COLOR}}"/>
  <rect x="10" y="11" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="12" y="13" width="2" height="2" fill="{{COLOR}}"/>
</svg>`;

// A block: dimmed header band on top, solid body below, what Explorer
// browses. No vertical bar, so it does not echo mempool.space's trademark
// composition; and not a magnifier, so it never reads as the Search command
// next to it.
const EXPLORER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="2" y="2" width="12" height="5" rx="1.5" fill="{{COLOR}}" fill-opacity="0.45"/>
  <rect x="2" y="6.5" width="12" height="7.5" rx="1.5" fill="{{COLOR}}"/>
</svg>`;

// Books standing on a shelf. Upright on purpose: a stack of books lying flat
// is the obvious drawing, and it is the one shape already taken, Explorer is
// two stacked blocks, directly above this entry in the same column. Turning
// the books vertical keeps the "several books" idea without the echo.
//
// Unequal heights, or three identical bars read as a bar chart. The shelf
// carries the solid fill and the books the 45% one, so the structure and its
// contents never merge into a single mass at 18px.
const LEARN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="2" y="2" width="3" height="10" fill="{{COLOR}}" fill-opacity="0.45"/>
  <rect x="6" y="4" width="3" height="8" fill="{{COLOR}}" fill-opacity="0.45"/>
  <rect x="10" y="3" width="3" height="9" fill="{{COLOR}}" fill-opacity="0.45"/>
  <rect x="1" y="12" width="14" height="2" fill="{{COLOR}}"/>
</svg>`;

// Building blocks: two on the ground, one being placed on top. The wallet
// glyph this replaces is reserved for the real Wallet entry, the day it
// joins this sidebar; a practice space wearing the money icon was the exact
// wrong message. The placed block carries the solid fill against the base's
// 45%, same subject-over-structure rule as Learn's books on their shelf.
const PLAYGROUND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="5" y="2.5" width="6" height="5" rx="1" fill="{{COLOR}}"/>
  <rect x="1.5" y="8.5" width="6" height="5" rx="1" fill="{{COLOR}}" fill-opacity="0.45"/>
  <rect x="8.5" y="8.5" width="6" height="5" rx="1" fill="{{COLOR}}" fill-opacity="0.45"/>
</svg>`;

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
  shortcut,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  /** The section currently on screen, shaded like the active chat entry. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-2.5 cursor-pointer border-none outline-none transition-colors hover:bg-white/5"
      style={{ color: 'var(--alice-text)', backgroundColor: active ? 'var(--alice-bg)' : 'transparent' }}
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0 opacity-70">
        {icon}
      </span>
      <span className="font-numbers text-sm flex-1 text-left">{label}</span>
      {shortcut && (
        <span
          className="font-numbers text-xs shrink-0"
          style={{ color: 'var(--alice-muted)', opacity: 0.5 }}
        >
          {shortcut}
        </span>
      )}
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
        className="hidden md:flex flex-col items-center gap-1 shrink-0 h-full"
        style={{
          width: 48,
          position: 'relative',
          paddingTop: isDesktop ? TITLEBAR_HEIGHT + 12 : 12,
          paddingBottom: 12,
          backgroundColor: 'var(--alice-sidebar-bg, var(--alice-bg-soft))',
          borderRight: '1px solid var(--alice-border)',
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
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Expand sidebar"
        >
          <SvgIcon svg={SIDEBAR_ICON_SVG} size={18} color="var(--alice-primary)" />
        </button>
        <button
          onClick={() => { clearMessages(); router.push('/'); }}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="New chat"
        >
          <SvgIcon svg={CHAT_ICON_SVG} size={18} color="var(--alice-primary)" />
        </button>
        <button
          onClick={() => router.push('/explorer')}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Explorer"
        >
          <SvgIcon svg={EXPLORER_ICON_SVG} size={18} color="var(--alice-primary)" />
        </button>
        <button
          onClick={() => { router.push('/learn'); window.dispatchEvent(new Event('alice-learn-reset')); }}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Learn"
        >
          <SvgIcon svg={LEARN_ICON_SVG} size={18} color="var(--alice-primary)" />
        </button>
        <button
          onClick={() => { onToggle(); setSearchOpen(true); }}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Search"
        >
          <SvgIcon svg={SEARCH_ICON_SVG} size={18} color="var(--alice-primary)" />
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
        className={`${mobileOpen ? 'fixed inset-0 z-50 flex' : 'hidden md:flex'} md:relative md:z-auto flex-col shrink-0 h-full w-full md:w-[var(--sidebar-w,260px)]`}
        style={{
          ['--sidebar-w' as string]: `${panelWidth}px`,
          backgroundColor: 'var(--alice-sidebar-bg, var(--alice-bg-soft))',
          borderRight: '1px solid var(--alice-border)',
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
          style={{ height: 44 }}
        >
          <div className="flex items-center gap-2">
            <AliceLogo size={20} />
            <span className="font-pixel" style={{ fontSize: 12, lineHeight: '20px', color: 'var(--alice-primary)' }}>
              Alice
            </span>
          </div>
          <button
            onClick={mobileOpen ? onMobileClose : onToggle}
            className="w-8 h-8 flex items-center justify-center cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
            aria-label={mobileOpen ? 'Close menu' : 'Collapse sidebar'}
          >
            <SvgIcon svg={SIDEBAR_ICON_SVG} size={16} color="var(--alice-primary)" />
          </button>
        </div>

        {/* Menu items */}
        <div className="flex flex-col shrink-0">
          <MenuItem
            icon={<SvgIcon svg={CHAT_ICON_SVG} size={18} color="var(--alice-primary)" />}
            label="New Chat"
            shortcut="⌘ N"
            onClick={() => { clearMessages(); router.push('/'); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={EXPLORER_ICON_SVG} size={18} color="var(--alice-primary)" />}
            label="Explorer"
            active={pathname.startsWith('/explorer')}
            onClick={() => { router.push('/explorer'); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={LEARN_ICON_SVG} size={18} color="var(--alice-primary)" />}
            label="Learn"
            active={pathname.startsWith('/learn')}
            onClick={() => { router.push('/learn'); window.dispatchEvent(new Event('alice-learn-reset')); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={PLAYGROUND_ICON_SVG} size={18} color="var(--alice-primary)" />}
            label="Playground"
            active={pathname.startsWith('/playground')}
            onClick={() => { router.push('/playground'); closeIfMobile(); }}
          />
        </div>

        {/* Chats section */}
        <div
          className="flex items-center justify-between gap-2 pl-4 pr-2 pt-4 pb-1 shrink-0"
          style={{ borderTop: '1px solid var(--alice-border)', marginTop: 8 }}
        >
          <span
            className="font-numbers text-xs uppercase tracking-wider"
            style={{ color: 'var(--alice-muted)', opacity: 0.6 }}
          >
            Chats
          </span>
          <button
            onClick={() => setSearchOpen(prev => !prev)}
            className="w-7 h-7 flex items-center justify-center shrink-0 cursor-pointer bg-transparent border-none outline-none transition-opacity"
            style={{ opacity: searchOpen ? 1 : 0.55 }}
            aria-label="Search conversations"
            aria-expanded={searchOpen}
            title="Search conversations (⌘ K)"
          >
            <SvgIcon svg={SEARCH_ICON_SVG} size={15} color="var(--alice-primary)" />
          </button>
        </div>

        {/* Search input (toggled from the Chats header) */}
        {searchOpen && (
          <div className="px-3 pt-1 pb-2 shrink-0">
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
              }}
              placeholder="Search conversations..."
              className="w-full font-numbers outline-none"
              style={{
                height: 32,
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
              style={{ fontSize: 15, color: 'var(--alice-muted)', opacity: 0.5 }}
            >
              {searchQuery ? 'No results' : 'No conversations yet'}
            </p>
          ) : (
            visibleSessions.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  className="group flex items-center gap-1 rounded-sm mb-0.5"
                  style={{
                    backgroundColor: isActive
                      ? 'var(--alice-bg)'
                      : 'transparent',
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
                    className="flex-1 text-left cursor-pointer bg-transparent border-none outline-none py-2 px-2.5 min-w-0"
                  >
                    <p
                      className="font-numbers m-0 truncate"
                      style={{
                        fontSize: 15,
                        lineHeight: '18px',
                        color: isActive ? 'var(--alice-text)' : 'var(--alice-muted)',
                      }}
                    >
                      {session.title}
                    </p>
                  </button>
                  <button
                    onClick={() => setPendingDelete(session)}
                    className="w-6 h-6 items-center justify-center cursor-pointer bg-transparent border-none outline-none shrink-0 mr-1 hidden group-hover:flex"
                    style={{ color: 'var(--alice-muted)', fontSize: 16 }}
                    aria-label="Delete session"
                  >
                    ×
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
              className="font-pixel tracking-widest block mx-auto my-3 px-2 py-2 cursor-pointer bg-transparent border-none"
              style={{ fontSize: 10, color: 'var(--alice-muted)', opacity: 0.75 }}
            >
              LOAD {Math.min(SESSION_PAGE_SIZE, filteredSessions.length - visibleSessions.length)} MORE
            </button>
          ) : filteredSessions.length > SESSION_PAGE_SIZE ? (
            <p
              className="font-pixel tracking-widest text-center my-3"
              style={{ fontSize: 10, color: 'var(--alice-muted)', opacity: 0.6 }}
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

      {/* Delete confirmation modal */}
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
              style={{ fontSize: 10, color: 'var(--alice-primary-dark)' }}
            >
              DELETE CONVERSATION
            </h3>
            <p
              className="font-numbers m-0 mt-3"
              style={{ fontSize: 15, lineHeight: '20px', opacity: 0.8 }}
            >
              Delete &ldquo;{pendingDelete.title}&rdquo; from your history? This cannot be undone.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setPendingDelete(null)}
                className="font-pixel tracking-widest flex-1 cursor-pointer"
                style={{
                  fontSize: 10,
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
                  fontSize: 10,
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
