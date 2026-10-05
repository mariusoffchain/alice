'use client';

import { useEffect } from 'react';
import { trackProductEvent } from '@alice-wallet/alice-ai';
import { SvgIcon } from '@/components/SvgIcon';
import { SETTINGS_TABS, type SettingsTab } from './tabs';

function TabButton({
  tab,
  isActive,
  onSelect,
}: {
  tab: SettingsTab;
  isActive: boolean;
  onSelect: () => void;
}) {
  const color = isActive ? 'var(--alice-selected)' : 'var(--alice-muted)';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      onClick={onSelect}
      id={`settings-tab-${tab.id}`}
      aria-controls="settings-tab-panel"
      className="alice-control alice-control--choice font-numbers min-w-0 w-full"
      style={{ color, justifyContent: 'flex-start', boxShadow: isActive ? 'inset 0 -2px var(--alice-selected)' : undefined }}
    >
      <span className="flex w-full flex-col items-center gap-1 sm:flex-row sm:gap-2.5">
        <span className="flex items-center justify-center shrink-0" style={{ width: 20, height: 20 }}>
          <SvgIcon svg={tab.icon} size={20} color={color} />
        </span>
        <span
          className="font-numbers text-center sm:text-left leading-tight sm:whitespace-nowrap"
          style={{ fontSize: 13 }}
        >
          {tab.label}
        </span>
      </span>
    </button>
  );
}

/**
 * The tab rail plus the active tab's content. Shared by the dialog that opens
 * over the app and by the /settings route, so the two can never drift apart.
 */
export function SettingsPanel({
  activeTab,
  onSelectTab,
}: {
  activeTab: string;
  onSelectTab: (id: string) => void;
}) {
  useEffect(() => {
    trackProductEvent('settings_opened');
  }, []);

  const active = SETTINGS_TABS.find(tab => tab.id === activeTab) ?? SETTINGS_TABS[0];
  const ActiveComponent = active.Component;

  return (
    <div className="flex flex-col sm:flex-row flex-1 min-h-0">
      <nav
        className={
          'shrink-0 border-b sm:border-b-0 sm:border-r '
          // Six tabs in two rows on a phone, a plain column from `sm` up.
          + 'grid grid-cols-3 sm:flex sm:flex-col sm:gap-0.5 '
          + 'w-full sm:w-[180px] px-0 sm:px-2 py-0 sm:py-3 sm:overflow-y-auto'
        }
        style={{ borderColor: 'var(--alice-border)' }}
        onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const current = SETTINGS_TABS.findIndex(tab => tab.id === active.id);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? SETTINGS_TABS.length - 1
            : (current + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length;
          onSelectTab(SETTINGS_TABS[next].id);
          document.getElementById(`settings-tab-${SETTINGS_TABS[next].id}`)?.focus();
        }}
        role="tablist"
        aria-label="Settings sections"
      >
        {SETTINGS_TABS.map((tab, index) => {
          const previous = SETTINGS_TABS[index - 1];
          const startsGroup = previous && previous.group !== tab.group;
          return (
            <div key={tab.id} className="contents sm:block">
              {startsGroup && (
                <div
                  aria-hidden
                  className="hidden sm:block"
                  style={{
                    height: 1,
                    margin: '8px 4px',
                    backgroundColor: 'var(--alice-border)',
                  }}
                />
              )}
              <TabButton
                tab={tab}
                isActive={tab.id === active.id}
                onSelect={() => onSelectTab(tab.id)}
              />
            </div>
          );
        })}
      </nav>

      <div id="settings-tab-panel" role="tabpanel" aria-labelledby={`settings-tab-${active.id}`} className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}
