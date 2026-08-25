// Per-network node overrides. The public mempool.space endpoints throttle
// aggressively, so a user can point any Bitcoin network at their own Esplora or
// mempool instance. Overrides live in localStorage (client-only); an empty or
// absent override falls back to the network's built-in default.

import { getNetwork, NETWORKS, type Network } from './networks.ts';

const KEY_PREFIX = 'alice_explorer_node_';

/** The stored override for a network, or '' when none is set. Pure read. */
export function getNodeOverride(networkId: string): string {
  if (typeof localStorage === 'undefined') return '';
  return (localStorage.getItem(KEY_PREFIX + networkId) ?? '').trim();
}

/** Persist an override; an empty value clears it (back to the default). */
export function setNodeOverride(networkId: string, url: string): void {
  if (typeof localStorage === 'undefined') return;
  const clean = url.trim().replace(/\/$/, '');
  if (clean) localStorage.setItem(KEY_PREFIX + networkId, clean);
  else localStorage.removeItem(KEY_PREFIX + networkId);
}

/** The endpoint a network should actually talk to: override first, else default. */
export function effectiveBaseUrl(networkId: string): string | undefined {
  return getNodeOverride(networkId) || getNetwork(networkId).baseUrl;
}

/** True when the network is running on a user-supplied node, not the default. */
export function isUsingCustomNode(networkId: string): boolean {
  const override = getNodeOverride(networkId);
  return override !== '' && override !== getNetwork(networkId).baseUrl;
}

/** The Bitcoin networks whose node can be changed (they share the Esplora API). */
export function configurableNetworks(): Network[] {
  return NETWORKS.filter(n => n.kind === 'bitcoin' && n.baseUrl);
}
