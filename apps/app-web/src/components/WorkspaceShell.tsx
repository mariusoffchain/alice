'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { isTauriDesktop } from '@alice-wallet/alice-ai';
import { Sidebar, SIDEBAR_ICON_SVG } from './Sidebar';
import { SvgIcon } from './SvgIcon';

/** Shared navigation frame for the workspaces; each keeps its own tools. */
export function WorkspaceShell({ title, children, aside }: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeDrawer = () => { if (desktop.matches) setMobileOpen(false); };
    desktop.addEventListener('change', closeDrawer);
    return () => desktop.removeEventListener('change', closeDrawer);
  }, []);

  return (
    <div className="atelier-workspace flex h-full overflow-hidden" style={{ backgroundColor: 'var(--alice-bg)' }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(value => !value)}
        mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <main className="flex flex-col flex-1 min-w-0 min-h-0" aria-label={title} inert={mobileOpen || undefined}>
        {isTauriDesktop() && <div data-tauri-drag-region className="shrink-0" style={{ height: 28 }} />}
        <div className="workspace-mobile-header md:hidden">
          <button type="button" className="alice-control alice-control--tool" aria-label="Open menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
            <SvgIcon svg={SIDEBAR_ICON_SVG} size={20} color="var(--alice-muted)" />
          </button>
          <span className="font-pixel">{title}</span>
        </div>
        {children}
      </main>
      {aside}
    </div>
  );
}
