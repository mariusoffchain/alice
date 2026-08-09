import type { SwapProvider } from './network-config.ts';

export interface LegacyBoltzPurgeMarkerStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type LegacyBoltzPurgeResult =
  | 'skipped'
  | 'already-purged'
  | 'purged';

type LegacyBoltzPurgeOptions = {
  network: 'mutinynet' | 'bitcoin';
  provider: SwapProvider;
  storageScope: 'native-sqlite' | 'web-indexeddb' | 'web-cache';
  markerStore: LegacyBoltzPurgeMarkerStore;
  clearLegacyState(): Promise<void>;
};

const PURGE_VERSION = 'v1';

export function legacyBoltzPurgeMarker(
  network: 'mutinynet' | 'bitcoin',
  storageScope: LegacyBoltzPurgeOptions['storageScope'],
): string {
  return `alice:legacy-boltz-purge:${network}:${storageScope}:${PURGE_VERSION}`;
}

export async function purgeLegacyBoltzSwapsOnce({
  network,
  provider,
  storageScope,
  markerStore,
  clearLegacyState,
}: LegacyBoltzPurgeOptions): Promise<LegacyBoltzPurgeResult> {
  if (network !== 'mutinynet' || provider !== 'satora') return 'skipped';

  const marker = legacyBoltzPurgeMarker(network, storageScope);
  if (await markerStore.getItem(marker)) return 'already-purged';

  await clearLegacyState();
  await markerStore.setItem(marker, new Date().toISOString());
  return 'purged';
}
