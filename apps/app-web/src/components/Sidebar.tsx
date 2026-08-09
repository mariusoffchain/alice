'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  type ChatSession,
  useAccount,
  useChat,
  isTauriDesktop,
} from '@alice-wallet/alice-ai';
import { SETTINGS_SVG } from '@alice-wallet/alice-ui/components/settings-icon-svg';
import { SvgIcon } from '@/components/SvgIcon';
import { AliceLogo } from '@/components/AliceLogo';
import { FeedbackModal } from '@/components/FeedbackModal';
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

const CHAT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="3" y="1" width="10" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="13" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="5" width="2" height="4" fill="{{COLOR}}"/>
  <rect x="13" y="5" width="2" height="4" fill="{{COLOR}}"/>
  <rect x="3" y="9" width="10" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="9" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="5" y="11" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="3" y="13" width="2" height="2" fill="{{COLOR}}"/>
</svg>`;

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

// Beetle seen from above: antennae, head, shell, three legs a side. The bug is
// the established icon for "report a bug" (GitHub, Jira, Sentry); a wrench or
// hammer would read as settings or maintenance instead.
const REPORT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="4" y="1" width="1" height="2" fill="{{COLOR}}"/>
  <rect x="11" y="1" width="1" height="2" fill="{{COLOR}}"/>
  <rect x="6" y="2" width="4" height="2" fill="{{COLOR}}"/>
  <rect x="5" y="4" width="6" height="9" fill="{{COLOR}}"/>
  <rect x="2" y="5" width="3" height="1" fill="{{COLOR}}"/>
  <rect x="2" y="8" width="3" height="1" fill="{{COLOR}}"/>
  <rect x="2" y="11" width="3" height="1" fill="{{COLOR}}"/>
  <rect x="11" y="5" width="3" height="1" fill="{{COLOR}}"/>
  <rect x="11" y="8" width="3" height="1" fill="{{COLOR}}"/>
  <rect x="11" y="11" width="3" height="1" fill="{{COLOR}}"/>
</svg>`;

const ACCOUNT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="5" y="1" width="6" height="2" fill="{{COLOR}}"/>
  <rect x="3" y="3" width="2" height="5" fill="{{COLOR}}"/>
  <rect x="11" y="3" width="2" height="5" fill="{{COLOR}}"/>
  <rect x="5" y="8" width="6" height="2" fill="{{COLOR}}"/>
  <rect x="3" y="11" width="10" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="13" width="14" height="2" fill="{{COLOR}}"/>
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-2.5 cursor-pointer bg-transparent border-none outline-none transition-colors hover:bg-white/5"
      style={{ color: 'var(--alice-text)' }}
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

function SidebarVersion({ collapsed, isDesktop }: { collapsed: boolean; isDesktop: boolean }) {
  const version = isDesktop
    ? appDesktopPackage.version
    : appWebPackage.version;

  return (
    <div
      className={collapsed ? 'mt-auto pt-3' : 'mt-auto px-4 py-3'}
      style={{
        borderTop: collapsed ? 'none' : '1px solid var(--alice-border)',
        width: collapsed ? '100%' : undefined,
      }}
    >
      <p
        className="font-numbers m-0 text-center"
        style={{
          fontSize: collapsed ? 9 : 11,
          lineHeight: collapsed ? '12px' : '16px',
          color: 'var(--alice-muted)',
          opacity: 0.55,
          letterSpacing: collapsed ? 0.3 : 0.4,
        }}
        title={`Version ${version}`}
      >
        v{version}
      </p>
    </div>
  );
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const router = useRouter();
  const { sessions, openSession, removeSession, refreshSessions, clearMessages, activeSessionId } = useChat();
  const account = useAccount();
  const [pendingDelete, setPendingDelete] = useState<ChatSession | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [visibleSessionCount, setVisibleSessionCount] = useState(SESSION_PAGE_SIZE);

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
      }
      if (e.metaKey && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
      if (e.metaKey && e.key === ',') {
        e.preventDefault();
        router.push('/settings');
      }
      if (e.key === 'Escape' && mobileOpen) {
        onMobileClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [clearMessages, router, mobileOpen, onMobileClose]);

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
          <SvgIcon svg={SIDEBAR_ICON_SVG} size={18} color="var(--alice-text)" />
        </button>
        <button
          onClick={() => clearMessages()}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="New chat"
        >
          <SvgIcon svg={CHAT_ICON_SVG} size={18} color="var(--alice-text)" />
        </button>
        <button
          onClick={() => { onToggle(); setSearchOpen(true); }}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Search"
        >
          <SvgIcon svg={SEARCH_ICON_SVG} size={18} color="var(--alice-text)" />
        </button>
        <button
          onClick={() => router.push('/settings')}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Settings"
        >
          <SvgIcon svg={SETTINGS_SVG} size={18} color="var(--alice-text)" />
        </button>
        <button
          onClick={account.requestSignIn}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Alice account"
          title={account.cloudQuota
            ? `${account.cloudQuota.remaining} Private Cloud requests left`
            : 'Alice account'}
        >
          <SvgIcon svg={ACCOUNT_ICON_SVG} size={18} color="var(--alice-text)" />
        </button>
        <button
          onClick={() => setFeedbackOpen(true)}
          className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Report"
        >
          <SvgIcon svg={REPORT_ICON_SVG} size={18} color="var(--alice-text)" />
        </button>
        <SidebarVersion collapsed isDesktop={isDesktop} />
        {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
      </div>
    );
  }

  return (
    <>
      <div
        className={`${mobileOpen ? 'fixed inset-0 z-50 flex' : 'hidden md:flex'} md:static md:z-auto flex-col shrink-0 h-full w-full md:w-[260px]`}
        style={{
          backgroundColor: 'var(--alice-sidebar-bg, var(--alice-bg-soft))',
          borderRight: '1px solid var(--alice-border)',
        }}
      >
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
            <span className="font-pixel" style={{ fontSize: 12, lineHeight: '20px', color: 'var(--alice-text)' }}>
              Alice
            </span>
          </div>
          <button
            onClick={mobileOpen ? onMobileClose : onToggle}
            className="w-8 h-8 flex items-center justify-center cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
            aria-label={mobileOpen ? 'Close menu' : 'Collapse sidebar'}
          >
            <SvgIcon svg={SIDEBAR_ICON_SVG} size={16} color="var(--alice-text)" />
          </button>
        </div>

        {/* Menu items */}
        <div className="flex flex-col shrink-0">
          <MenuItem
            icon={<SvgIcon svg={CHAT_ICON_SVG} size={18} color="var(--alice-text)" />}
            label="New Chat"
            shortcut="⌘ N"
            onClick={() => { clearMessages(); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={SEARCH_ICON_SVG} size={18} color="var(--alice-text)" />}
            label="Search"
            shortcut="⌘ K"
            onClick={() => setSearchOpen(prev => !prev)}
          />
          <MenuItem
            icon={<SvgIcon svg={SETTINGS_SVG} size={18} color="var(--alice-text)" />}
            label="Settings"
            shortcut="⌘ ,"
            onClick={() => { router.push('/settings'); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={ACCOUNT_ICON_SVG} size={18} color="var(--alice-text)" />}
            label="Account"
            shortcut={account.cloudQuota
              ? `${account.cloudQuota.remaining}/${account.cloudQuota.limit}`
              : undefined}
            onClick={() => { account.requestSignIn(); closeIfMobile(); }}
          />
          <MenuItem
            icon={<SvgIcon svg={REPORT_ICON_SVG} size={18} color="var(--alice-text)" />}
            label="Report"
            onClick={() => { setFeedbackOpen(true); closeIfMobile(); }}
          />
        </div>

        {/* Search input (toggled) */}
        {searchOpen && (
          <div className="px-3 pt-2 pb-1">
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

        {/* Chats section */}
        <div
          className="px-4 pt-4 pb-1 shrink-0"
          style={{ borderTop: '1px solid var(--alice-border)', marginTop: 8 }}
        >
          <span
            className="font-numbers text-xs uppercase tracking-wider"
            style={{ color: 'var(--alice-muted)', opacity: 0.6 }}
          >
            Chats
          </span>
        </div>

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
              style={{ fontSize: 6, color: 'var(--alice-muted)', opacity: 0.75 }}
            >
              LOAD {Math.min(SESSION_PAGE_SIZE, filteredSessions.length - visibleSessions.length)} MORE
            </button>
          ) : filteredSessions.length > SESSION_PAGE_SIZE ? (
            <p
              className="font-pixel tracking-widest text-center my-3"
              style={{ fontSize: 6, color: 'var(--alice-muted)', opacity: 0.6 }}
            >
              {visibleSessions.length} OF {filteredSessions.length}
            </p>
          ) : null}
        </div>

        <SidebarVersion collapsed={false} isDesktop={isDesktop} />
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
              style={{ fontSize: 9, color: 'var(--alice-primary-dark)' }}
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
