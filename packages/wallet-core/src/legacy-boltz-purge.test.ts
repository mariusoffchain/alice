import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  legacyBoltzPurgeMarker,
  purgeLegacyBoltzSwapsOnce,
  type LegacyBoltzPurgeMarkerStore,
} from './legacy-boltz-purge.ts';

class MemoryMarkerStore implements LegacyBoltzPurgeMarkerStore {
  readonly values = new Map<string, string>();

  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

describe('legacy Boltz purge', () => {
  it('purges once before marking the Mutinynet Satora migration complete', async () => {
    const markers = new MemoryMarkerStore();
    const events: string[] = [];

    const first = await purgeLegacyBoltzSwapsOnce({
      network: 'mutinynet',
      provider: 'satora',
      storageScope: 'native-sqlite',
      markerStore: markers,
      clearLegacyState: async () => {
        events.push('clear');
        assert.equal(
          await markers.getItem(legacyBoltzPurgeMarker(
            'mutinynet',
            'native-sqlite',
          )),
          null,
        );
      },
    });
    const second = await purgeLegacyBoltzSwapsOnce({
      network: 'mutinynet',
      provider: 'satora',
      storageScope: 'native-sqlite',
      markerStore: markers,
      clearLegacyState: async () => {
        events.push('clear-again');
      },
    });

    assert.equal(first, 'purged');
    assert.equal(second, 'already-purged');
    assert.deepEqual(events, ['clear']);
    assert.ok(await markers.getItem(legacyBoltzPurgeMarker(
      'mutinynet',
      'native-sqlite',
    )));
  });

  it('does not purge while Boltz is active or on Bitcoin mainnet', async () => {
    const markers = new MemoryMarkerStore();
    let clears = 0;
    const clearLegacyState = async () => {
      clears += 1;
    };

    assert.equal(await purgeLegacyBoltzSwapsOnce({
      network: 'mutinynet',
      provider: 'boltz',
      storageScope: 'native-sqlite',
      markerStore: markers,
      clearLegacyState,
    }), 'skipped');
    assert.equal(await purgeLegacyBoltzSwapsOnce({
      network: 'bitcoin',
      provider: 'satora',
      storageScope: 'native-sqlite',
      markerStore: markers,
      clearLegacyState,
    }), 'skipped');

    assert.equal(clears, 0);
    assert.equal(markers.values.size, 0);
  });

  it('does not mark a failed purge and retries on the next launch', async () => {
    const markers = new MemoryMarkerStore();
    let attempts = 0;
    const options = {
      network: 'mutinynet' as const,
      provider: 'satora' as const,
      storageScope: 'native-sqlite' as const,
      markerStore: markers,
      clearLegacyState: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('storage unavailable');
      },
    };

    await assert.rejects(
      purgeLegacyBoltzSwapsOnce(options),
      /storage unavailable/,
    );
    assert.equal(
      await markers.getItem(legacyBoltzPurgeMarker(
        'mutinynet',
        'native-sqlite',
      )),
      null,
    );
    assert.equal(await purgeLegacyBoltzSwapsOnce(options), 'purged');
    assert.equal(attempts, 2);
  });

  it('uses separate markers for every persistence backend', () => {
    assert.notEqual(
      legacyBoltzPurgeMarker('mutinynet', 'native-sqlite'),
      legacyBoltzPurgeMarker('mutinynet', 'web-indexeddb'),
    );
    assert.notEqual(
      legacyBoltzPurgeMarker('mutinynet', 'web-indexeddb'),
      legacyBoltzPurgeMarker('mutinynet', 'web-cache'),
    );
  });
});
