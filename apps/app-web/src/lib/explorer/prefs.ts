// User preferences for Explorer that are not per-network endpoints (those live
// in node-config). Client-only, localStorage, with a safe fallback whenever the
// stored value no longer matches a network Explorer can actually open.

import { DEFAULT_NETWORK_ID, NETWORKS, type Network } from './networks.ts';

const DEFAULT_NETWORK_KEY = 'alice.explorer.default-network';

/**
 * The networks a user may start on. Bitcoin chains only: Explorer's overview
 * needs an Esplora endpoint, and Arkade has none (it reads an ASP gateway and
 * only ever opens as an address tab), so starting there would leave the
 * overview without a provider.
 */
export function selectableNetworks(): Network[] {
  return NETWORKS.filter(n => n.available && n.kind === 'bitcoin' && n.baseUrl);
}

/**
 * The network Explorer opens on. Falls back to the built-in default when the
 * stored id is unknown or points at a network that is no longer selectable, so
 * a stale preference can never strand the user on a dead tab.
 */
export function getDefaultNetworkId(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_NETWORK_ID;
  const stored = localStorage.getItem(DEFAULT_NETWORK_KEY);
  if (!stored) return DEFAULT_NETWORK_ID;
  return selectableNetworks().some(n => n.id === stored) ? stored : DEFAULT_NETWORK_ID;
}

/** Persist the starting network; the built-in default clears the override. */
export function setDefaultNetworkId(networkId: string): void {
  if (typeof localStorage === 'undefined') return;
  if (networkId === DEFAULT_NETWORK_ID || !selectableNetworks().some(n => n.id === networkId)) {
    localStorage.removeItem(DEFAULT_NETWORK_KEY);
    return;
  }
  localStorage.setItem(DEFAULT_NETWORK_KEY, networkId);
}
