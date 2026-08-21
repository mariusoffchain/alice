import type { Href } from 'expo-router';

/**
 * The Advanced hub, declared in one place. Same shape as settings-sections:
 * a new advanced tool adds one entry and ships its screen, and the hub files it
 * under the right heading without anyone editing the layout.
 */

/** 'connection' is how the app talks to the outside and what it logged,
 *  'coins' is managing what the wallet holds, 'recovery' is getting funds out
 *  when something went wrong, 'developer' never ships. */
export type AdvancedGroup = 'connection' | 'coins' | 'recovery' | 'developer';

export const ADVANCED_GROUP_ORDER: AdvancedGroup[] = [
  'connection',
  'coins',
  'recovery',
  'developer',
];

export interface AdvancedSection {
  id: string;
  label: string;
  route: Href;
  group: AdvancedGroup;
}

const ADVANCED_SECTIONS: AdvancedSection[] = [
  { id: 'logs', label: 'LOGS', route: '/advanced-logs', group: 'connection' },
  { id: 'server', label: 'SERVER', route: '/advanced-server', group: 'connection' },
  { id: 'coin-control', label: 'COIN CONTROL', route: '/coin-control', group: 'coins' },
  { id: 'addresses', label: 'ADDRESSES', route: '/addresses', group: 'coins' },
  { id: 'delegates', label: 'DELEGATED RENEWAL', route: '/delegates', group: 'coins' },
  { id: 'swap-ids', label: 'SWAP IDs', route: '/swap-ids', group: 'recovery' },
  { id: 'emergency-exit', label: 'EMERGENCY EXIT', route: '/emergency-exit', group: 'recovery' },
  // A developer tool that deliberately lets a swap expire so it can be
  // refunded. It was hidden by the swap provider, which made its visibility an
  // accident of configuration: a Boltz build would have shipped it to testers.
  // It is gated on the build type instead, so no distributed build can show it
  // whatever the provider is. Keeping it in its own group makes that obvious.
  { id: 'test', label: 'TEST', route: '/advanced-test', group: 'developer' },
];

/** The sections of a group, empty when the whole group is gated out of this
 *  build (the hub then draws no heading for it). */
export function advancedSectionsInGroup(group: AdvancedGroup): AdvancedSection[] {
  if (group === 'developer' && !__DEV__) return [];
  return ADVANCED_SECTIONS.filter(section => section.group === group);
}
