'use client';

import { useEffect, useRef, useState } from 'react';
import { SvgIcon } from '@/components/SvgIcon';
import { ACCOUNT_ICON, SETTINGS_ICON, HELP_ICON, EXTERNAL_ICON, GITHUB_ICON, GLOBE_ICON, CHEVRON_DOWN_ICON } from '@/lib/atelier-icons';

export const ALICE_SITE_URL = 'https://alicebtc.com';
export const ALICE_SOURCE_URL = 'https://github.com/mariusoffchain/alice';

/** Shown in place of a username while nobody is signed in. */
export const ANONYMOUS_NAME = 'Satoshi';

function MenuRow({
  icon,
  label,
  shortcut,
  external,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  external?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className="alice-control alice-control--option flex items-center gap-3 w-full px-3 py-2"
      style={{ color: 'var(--alice-text)' }}
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0 opacity-100">
        {icon}
      </span>
      <span className="font-numbers text-sm flex-1 text-left">{label}</span>
      {(shortcut || external) && (
        <span
          className="font-numbers text-xs shrink-0"
          style={{ color: 'var(--alice-muted)', opacity: 1 }}
        >
          {shortcut ?? <SvgIcon svg={EXTERNAL_ICON} size={16} color="currentColor" />}
        </span>
      )}
    </button>
  );
}

interface SidebarAccountMenuProps {
  collapsed: boolean;
  /** Username when signed in, otherwise null. */
  username: string | null;
  /** Masked email or any secondary identifier, shown under the name. */
  subtitle: string | null;
  version: string;
  onSettings: () => void;
  onAccount: () => void;
  onReport: () => void;
}

/**
 * The single entry point to everything that is not a conversation: settings,
 * the Alice account, bug reports and the project's public links. It sits at the
 * bottom of the sidebar where most chat applications put the same control, so the
 * command list above stays limited to what the user does every day.
 */
export function SidebarAccountMenu({
  collapsed,
  username,
  subtitle,
  version,
  onSettings,
  onAccount,
  onReport,
}: SidebarAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const name = username ?? ANONYMOUS_NAME;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const openExternal = (url: string) => () => {
    setOpen(false);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      ref={rootRef}
      className={collapsed ? 'mt-auto w-full flex justify-center' : 'mt-auto'}
      style={{
        position: 'relative',
        borderTop: collapsed ? 'none' : '1px solid var(--alice-border)',
        padding: collapsed ? '8px 0 0' : 8,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={username ? `Account: ${username}` : 'Account'}
        title={collapsed ? name : undefined}
        ref={triggerRef}
        className={`alice-control alice-control--option flex items-center ${
          collapsed ? 'justify-center w-9 h-9' : 'gap-2.5 w-full px-2 py-2'
        }`}
        style={{ color: 'var(--alice-text)' }}
      >
        {collapsed && <SvgIcon svg={ACCOUNT_ICON} size={16} color="currentColor" />}
        {!collapsed && (
          <>
            <span className="font-numbers text-sm flex-1 text-left truncate">
              {name}
            </span>
            <span
              className="font-numbers text-xs shrink-0"
              style={{ color: 'var(--alice-muted)', opacity: 1 }}
              aria-hidden="true"
            >
              <SvgIcon svg={CHEVRON_DOWN_ICON} size={16} color="currentColor" />
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account menu"
          onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}
          className="flex flex-col py-1"
          style={{
            position: 'absolute',
            bottom: collapsed ? 8 : 'calc(100% - 4px)',
            left: collapsed ? 'calc(100% + 6px)' : 8,
            right: collapsed ? undefined : 8,
            width: collapsed ? 220 : undefined,
            zIndex: 60,
            backgroundColor: 'var(--alice-bg)',
            border: '1px solid var(--alice-border)',
            borderRadius: 0,
            boxShadow: '3px 3px 0 var(--alice-border)',
          }}
        >
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <div className="min-w-0">
              <p
                className="font-numbers m-0 truncate"
                style={{ fontSize: 14, lineHeight: '18px', color: 'var(--alice-text)' }}
              >
                {name}
              </p>
              <p
                className="font-numbers m-0 truncate"
                style={{ fontSize: 11, lineHeight: '15px', color: 'var(--alice-muted)', opacity: 1 }}
              >
                {subtitle ?? (username ? 'Alice account' : 'Not signed in')}
              </p>
            </div>
          </div>

          <div style={{ height: 1, backgroundColor: 'var(--alice-border)' }} />

          <MenuRow
            icon={<SvgIcon svg={ACCOUNT_ICON} size={16} color="currentColor" />}
            // One entry either way: the dialog behind it offers both signing in
            // and creating, so naming one of the two here sends returning users
            // looking for a button that does not exist.
            label="Account"
            onClick={run(onAccount)}
          />
          <MenuRow
            icon={<SvgIcon svg={SETTINGS_ICON} size={16} color="currentColor" />}
            label="Settings"
            shortcut="⌘ ,"
            onClick={run(onSettings)}
          />
          <MenuRow
            icon={<SvgIcon svg={HELP_ICON} size={16} color="currentColor" />}
            label="Report an issue"
            onClick={run(onReport)}
          />

          <div style={{ height: 1, backgroundColor: 'var(--alice-border)' }} />

          <MenuRow
            icon={<SvgIcon svg={GLOBE_ICON} size={16} color="currentColor" />}
            label="Alice website"
            external
            onClick={openExternal(ALICE_SITE_URL)}
          />
          <MenuRow
            icon={<SvgIcon svg={GITHUB_ICON} size={16} color="currentColor" />}
            label="Source on GitHub"
            external
            onClick={openExternal(ALICE_SOURCE_URL)}
          />

          <div style={{ height: 1, backgroundColor: 'var(--alice-border)' }} />

          <p
            className="font-numbers m-0 px-3 py-2"
            style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 1 }}
          >
            Alice v{version}
          </p>
        </div>
      )}
    </div>
  );
}
