'use client';

import { SETTINGS_SVG } from '@alice-wallet/alice-ui/components/settings-icon-svg';
import { GeneralTab } from './GeneralTab';
import { AppearanceTab } from './AppearanceTab';
import { AiTab } from './AiTab';
import { AccountTab } from './AccountTab';
import { ExplorerTab } from './ExplorerTab';
import { DataTab } from './DataTab';

const PALETTE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="1" y="1" width="6" height="6" fill="{{COLOR}}"/>
  <rect x="9" y="1" width="6" height="6" fill="{{COLOR}}" fill-opacity="0.6"/>
  <rect x="1" y="9" width="6" height="6" fill="{{COLOR}}" fill-opacity="0.35"/>
  <rect x="9" y="9" width="6" height="6" fill="{{COLOR}}" fill-opacity="0.8"/>
</svg>`;

// A chip: a die with contacts down each side. Reads as "the model doing the
// thinking" without borrowing anyone's brain or sparkle mark.
const CHIP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="4" y="4" width="8" height="8" fill="{{COLOR}}"/>
  <rect x="4" y="1" width="1" height="2" fill="{{COLOR}}"/>
  <rect x="7.5" y="1" width="1" height="2" fill="{{COLOR}}"/>
  <rect x="11" y="1" width="1" height="2" fill="{{COLOR}}"/>
  <rect x="4" y="13" width="1" height="2" fill="{{COLOR}}"/>
  <rect x="7.5" y="13" width="1" height="2" fill="{{COLOR}}"/>
  <rect x="11" y="13" width="1" height="2" fill="{{COLOR}}"/>
  <rect x="1" y="4" width="2" height="1" fill="{{COLOR}}"/>
  <rect x="1" y="7.5" width="2" height="1" fill="{{COLOR}}"/>
  <rect x="1" y="11" width="2" height="1" fill="{{COLOR}}"/>
  <rect x="13" y="4" width="2" height="1" fill="{{COLOR}}"/>
  <rect x="13" y="7.5" width="2" height="1" fill="{{COLOR}}"/>
  <rect x="13" y="11" width="2" height="1" fill="{{COLOR}}"/>
</svg>`;

// Same block mark as the Explorer command in the sidebar, so the tab and the
// destination read as one thing.
const EXPLORER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="2" y="2" width="12" height="5" rx="1.5" fill="{{COLOR}}" fill-opacity="0.45"/>
  <rect x="2" y="6.5" width="12" height="7.5" rx="1.5" fill="{{COLOR}}"/>
</svg>`;

// A person over a baseline: the account and what it is entitled to.
const ACCOUNT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="6" y="1" width="4" height="4" fill="{{COLOR}}"/>
  <rect x="4" y="6" width="8" height="5" fill="{{COLOR}}"/>
  <rect x="2" y="13" width="12" height="2" fill="{{COLOR}}" fill-opacity="0.45"/>
</svg>`;

// Stacked platters: the standard disk mark for stored data.
const STORAGE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="2" y="2" width="12" height="3" fill="{{COLOR}}"/>
  <rect x="2" y="6.5" width="12" height="3" fill="{{COLOR}}" fill-opacity="0.7"/>
  <rect x="2" y="11" width="12" height="3" fill="{{COLOR}}" fill-opacity="0.45"/>
</svg>`;

export interface SettingsTab {
  id: string;
  /** Rail label. Kept to one word so the rail stays narrow. */
  label: string;
  /** SVG source with a {{COLOR}} placeholder, as SvgIcon expects. */
  icon: string;
  /** Rail grouping. 'alice' is how Alice behaves and looks, 'data' is what
   *  lives on this device. The rail draws a rule between the two. */
  group: 'alice' | 'data';
  Component: () => React.ReactNode;
}

/**
 * The whole settings surface, in order. A new feature adds one entry here and
 * ships its own tab component; nothing else needs to change, and both the
 * dialog and the /settings route pick it up.
 */
export const SETTINGS_TABS: SettingsTab[] = [
  { id: 'general', label: 'General', icon: SETTINGS_SVG, group: 'alice', Component: GeneralTab },
  { id: 'appearance', label: 'Appearance', icon: PALETTE_ICON_SVG, group: 'alice', Component: AppearanceTab },
  { id: 'ai', label: 'AI', icon: CHIP_ICON_SVG, group: 'alice', Component: AiTab },
  { id: 'account', label: 'Account', icon: ACCOUNT_ICON_SVG, group: 'alice', Component: AccountTab },
  { id: 'explorer', label: 'Explorer', icon: EXPLORER_ICON_SVG, group: 'data', Component: ExplorerTab },
  { id: 'data', label: 'Data', icon: STORAGE_ICON_SVG, group: 'data', Component: DataTab },
];

export const DEFAULT_SETTINGS_TAB = SETTINGS_TABS[0].id;

export function resolveSettingsTab(id: string | null | undefined): string {
  return SETTINGS_TABS.some(tab => tab.id === id) ? (id as string) : DEFAULT_SETTINGS_TAB;
}
