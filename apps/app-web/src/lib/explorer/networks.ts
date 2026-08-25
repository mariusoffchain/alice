// The networks Explorer can explore. Bitcoin networks share the Esplora API,
// so they only differ by base URL. Liquid (confidential amounts, multi-asset)
// and Arkade (off-chain VTXOs via an ASP) need different data models, so they
// are listed but not wired yet.

export type NetworkKind = 'bitcoin' | 'liquid' | 'arkade';

export type Network = {
  id: string;
  label: string;
  kind: NetworkKind;
  /** Esplora-compatible API base, present for the wired Bitcoin networks. */
  baseUrl?: string;
  /** Arkade ASP (arkd) REST gateway base, for the off-chain commitment/VTXO
   *  data. Present only for the Arkade network, which has no block sequence. */
  arkApiUrl?: string;
  /** False until its provider exists; shown in the picker but not selectable. */
  available: boolean;
  /** One-line note for the unavailable ones. */
  note?: string;
  /** Tab accent colour, so a tab's network is readable at a glance. */
  color: string;
  /** True for a test network (no real value), so the picker can group them
   *  apart from the production chains. */
  isTest?: boolean;
  /** Public stand-ins tried ONLY when the primary endpoint fails or throttles
   *  (never load-spreading: queries stay with one server on the happy path).
   *  `esploraOnly` marks bare Esplora instances without mempool's /v1 API. */
  fallbacks?: { baseUrl: string; name: string; esploraOnly?: boolean }[];
};

export const NETWORKS: Network[] = [
  {
    id: 'mainnet', label: 'Bitcoin', kind: 'bitcoin', baseUrl: 'https://mempool.space/api', available: true, color: '#f7931a',
    fallbacks: [
      { baseUrl: 'https://mempool.emzy.de/api', name: 'mempool.emzy.de' },
      { baseUrl: 'https://blockstream.info/api', name: 'blockstream.info', esploraOnly: true },
    ],
  },
  {
    id: 'liquid', label: 'Liquid', kind: 'liquid', baseUrl: 'https://liquid.network/api', available: true, color: '#34c2c2',
    note: 'confidential amounts are blinded and shown as unknown',
    fallbacks: [
      { baseUrl: 'https://blockstream.info/liquid/api', name: 'blockstream.info', esploraOnly: true },
    ],
  },
  // Arkade settles VTXOs off-chain via an ASP, on Bitcoin mainnet. It carries
  // no baseUrl of its own: the Explorer reuses the Bitcoin mainnet provider
  // (same endpoint, same caches) so the two views can never drift, and adds
  // the Arkade layer on top: settlement highlights, round overlays, VTXOs.
  // The public ASP gateway (CORS-open) serves that off-chain side.
  {
    id: 'arkade', label: 'Arkade', kind: 'arkade', available: true, color: '#3d1ba5',
    arkApiUrl: 'https://arkade.computer',
  },
  // Test networks, grouped apart from the production chains in the picker.
  { id: 'testnet4', label: 'Testnet4', kind: 'bitcoin', baseUrl: 'https://mempool.space/testnet4/api', available: true, color: '#3fa46a', isTest: true },
  { id: 'signet', label: 'Signet', kind: 'bitcoin', baseUrl: 'https://mempool.space/signet/api', available: true, color: '#9b7bd4', isTest: true },
  { id: 'mutinynet', label: 'Mutinynet', kind: 'bitcoin', baseUrl: 'https://mutinynet.com/api', available: true, color: '#e06699', isTest: true },
];

export const DEFAULT_NETWORK_ID = 'mainnet';

export function getNetwork(id: string): Network {
  return NETWORKS.find(n => n.id === id) ?? NETWORKS[0];
}
