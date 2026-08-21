'use client';

import { useEffect, useRef, useState } from 'react';
import { SETTINGS_SVG } from '@alice-wallet/alice-ui/components/settings-icon-svg';
import { SvgIcon } from '@/components/SvgIcon';

const ACCOUNT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="5" y="1" width="6" height="2" fill="{{COLOR}}"/>
  <rect x="3" y="3" width="2" height="5" fill="{{COLOR}}"/>
  <rect x="11" y="3" width="2" height="5" fill="{{COLOR}}"/>
  <rect x="5" y="8" width="6" height="2" fill="{{COLOR}}"/>
  <rect x="3" y="11" width="10" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="13" width="14" height="2" fill="{{COLOR}}"/>
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

const GLOBE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="5" y="1" width="6" height="2" fill="{{COLOR}}"/>
  <rect x="3" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="11" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="5" width="2" height="6" fill="{{COLOR}}"/>
  <rect x="13" y="5" width="2" height="6" fill="{{COLOR}}"/>
  <rect x="3" y="11" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="11" y="11" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="5" y="13" width="6" height="2" fill="{{COLOR}}"/>
  <rect x="2" y="7" width="12" height="2" fill="{{COLOR}}" fill-opacity="0.45"/>
  <rect x="7" y="2" width="2" height="12" fill="{{COLOR}}" fill-opacity="0.45"/>
</svg>`;

// Angle brackets around a slash: the generic "source code" mark. Deliberately
// not an Octocat lookalike, which is GitHub's trademark.
const CODE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="4" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="2" y="5" width="2" height="6" fill="{{COLOR}}"/>
  <rect x="4" y="11" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="10" y="3" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="12" y="5" width="2" height="6" fill="{{COLOR}}"/>
  <rect x="10" y="11" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="9" y="3" width="2" height="3" fill="{{COLOR}}"/>
  <rect x="8" y="6" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="7" y="8" width="2" height="2" fill="{{COLOR}}"/>
  <rect x="6" y="10" width="2" height="3" fill="{{COLOR}}"/>
</svg>`;

export const ALICE_SITE_URL = 'https://alicebtc.com';
export const ALICE_SOURCE_URL = 'https://github.com/mariusoffchain/alice';

/** Shown in place of a username while nobody is signed in. */
export const ANONYMOUS_NAME = 'Satoshi';

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="font-numbers flex items-center justify-center shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.48),
        lineHeight: 1,
        color: 'var(--alice-bg)',
        backgroundColor: 'var(--alice-primary)',
        textTransform: 'uppercase',
      }}
      aria-hidden="true"
    >
      {name.trim().charAt(0) || '?'}
    </span>
  );
}

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
      className="flex items-center gap-3 w-full px-3 py-2 cursor-pointer bg-transparent border-none outline-none transition-colors hover:bg-white/5"
      style={{ color: 'var(--alice-text)' }}
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0 opacity-70">
        {icon}
      </span>
      <span className="font-numbers text-sm flex-1 text-left">{label}</span>
      {(shortcut || external) && (
        <span
          className="font-numbers text-xs shrink-0"
          style={{ color: 'var(--alice-muted)', opacity: 0.5 }}
        >
          {shortcut ?? '↗'}
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
 * bottom of the sidebar where ChatGPT and Claude put the same control, so the
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const name = username ?? ANONYMOUS_NAME;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
        className={`flex items-center cursor-pointer bg-transparent border-none outline-none rounded-sm transition-colors hover:bg-white/5 ${
          collapsed ? 'justify-center w-9 h-9' : 'gap-2.5 w-full px-2 py-2'
        }`}
        style={{ color: 'var(--alice-text)' }}
      >
        <Avatar name={name} size={collapsed ? 22 : 24} />
        {!collapsed && (
          <>
            <span className="font-numbers text-sm flex-1 text-left truncate">
              {name}
            </span>
            <span
              className="font-numbers text-xs shrink-0"
              style={{ color: 'var(--alice-muted)', opacity: 0.6 }}
              aria-hidden="true"
            >
              ⌄
            </span>
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
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
            borderRadius: 2,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Avatar name={name} size={26} />
            <div className="min-w-0">
              <p
                className="font-numbers m-0 truncate"
                style={{ fontSize: 14, lineHeight: '18px', color: 'var(--alice-text)' }}
              >
                {name}
              </p>
              <p
                className="font-numbers m-0 truncate"
                style={{ fontSize: 11, lineHeight: '15px', color: 'var(--alice-muted)', opacity: 0.7 }}
              >
                {subtitle ?? (username ? 'Alice account' : 'Not signed in')}
              </p>
            </div>
          </div>

          <div style={{ height: 1, backgroundColor: 'var(--alice-border)' }} />

          <MenuRow
            icon={<SvgIcon svg={ACCOUNT_ICON_SVG} size={16} color="var(--alice-primary)" />}
            // One entry either way: the dialog behind it offers both signing in
            // and creating, so naming one of the two here sends returning users
            // looking for a button that does not exist.
            label="Account"
            onClick={run(onAccount)}
          />
          <MenuRow
            icon={<SvgIcon svg={SETTINGS_SVG} size={16} color="var(--alice-primary)" />}
            label="Settings"
            shortcut="⌘ ,"
            onClick={run(onSettings)}
          />
          <MenuRow
            icon={<SvgIcon svg={REPORT_ICON_SVG} size={16} color="var(--alice-primary)" />}
            label="Report an issue"
            onClick={run(onReport)}
          />

          <div style={{ height: 1, backgroundColor: 'var(--alice-border)' }} />

          <MenuRow
            icon={<SvgIcon svg={GLOBE_ICON_SVG} size={16} color="var(--alice-primary)" />}
            label="Alice website"
            external
            onClick={openExternal(ALICE_SITE_URL)}
          />
          <MenuRow
            icon={<SvgIcon svg={CODE_ICON_SVG} size={16} color="var(--alice-primary)" />}
            label="Source on GitHub"
            external
            onClick={openExternal(ALICE_SOURCE_URL)}
          />

          <div style={{ height: 1, backgroundColor: 'var(--alice-border)' }} />

          <p
            className="font-numbers m-0 px-3 py-2"
            style={{ fontSize: 11, color: 'var(--alice-muted)', opacity: 0.55 }}
          >
            Alice v{version}
          </p>
        </div>
      )}
    </div>
  );
}
