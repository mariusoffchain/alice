import type { Href } from 'expo-router';

/**
 * The settings hub, declared in one place. Mirrors app-web's tab registry: a
 * new feature adds one entry here and ships its screen, and the hub picks it up
 * with the right grouping without anyone editing the layout.
 *
 * The phone keeps drill-down navigation rather than app-web's tab rail. The
 * sections behind these rows are whole screens (Customize Alice alone is ~900
 * lines), so folding them into one tabbed screen would mean rewriting them, and
 * a row that pushes a screen is what a phone user expects anyway.
 */

/** 'alice' is how Alice behaves and looks, 'wallet' is this device and its
 *  keys, 'about' is the project itself. The hub rules a line between groups. */
export type SettingsGroup = 'alice' | 'wallet' | 'about';

export const SETTINGS_GROUP_ORDER: SettingsGroup[] = ['alice', 'wallet', 'about'];

export interface SettingsSection {
  id: string;
  /** Row label, shown as typed. */
  label: string;
  route: Href;
  group: SettingsGroup;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'account', label: 'ALICE ACCOUNT', route: '/account', group: 'alice' },
  { id: 'appearance', label: 'APPEARANCE', route: '/appearance', group: 'alice' },
  { id: 'ai', label: 'CUSTOMIZE ALICE', route: '/ai-settings', group: 'alice' },
  { id: 'lock', label: 'APP LOCK', route: '/security', group: 'wallet' },
  { id: 'advanced', label: 'ADVANCED', route: '/advanced', group: 'wallet' },
  { id: 'about', label: 'ABOUT', route: '/about', group: 'about' },
  { id: 'support', label: 'REPORT A PROBLEM', route: '/support', group: 'about' },
];

export function sectionsInGroup(group: SettingsGroup): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(section => section.group === group);
}
