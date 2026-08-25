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
  const color = isActive ? 'var(--alice-primary)' : 'var(--alice-text)';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onSelect}
      className={
        // Phone: a fifth of the row, icon over label, so the five fit without
        // scrolling and no label is ever cut mid-word. Desktop: a row in the
        // rail, with a left rule marking the active one.
        'flex min-w-0 cursor-pointer border-none outline-none transition-colors '
        + 'flex-col items-center gap-1 px-1 py-2 '
        + 'sm:flex-row sm:items-center sm:gap-2.5 sm:px-3 sm:py-2 sm:rounded-sm'
      }
      style={{
        backgroundColor: isActive ? 'var(--alice-card-bg)' : 'transparent',
        color,
        opacity: isActive ? 1 : 0.7,
      }}
    >
      <span className="flex items-center justify-center shrink-0" style={{ width: 16, height: 16 }}>
        <SvgIcon svg={tab.icon} size={16} color={color} />
      </span>
      <span
        className="font-numbers text-center sm:text-left leading-tight sm:whitespace-nowrap"
        style={{ fontSize: 11 }}
      >
        {tab.label}
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
          // Five equal columns on a phone, a plain column from `sm` up.
          + 'grid grid-cols-5 sm:flex sm:flex-col sm:gap-0.5 '
          + 'w-full sm:w-[180px] px-0 sm:px-2 py-0 sm:py-3 sm:overflow-y-auto'
        }
        style={{ borderColor: 'var(--alice-border)' }}
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

      <div className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}
