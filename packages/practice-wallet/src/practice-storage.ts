/**
 * Storage for the Mutinynet practice wallet.
 *
 * Fully disjoint from any real wallet storage: its own mnemonic entry, its
 * own state keys, and a deliberately lighter lifecycle (practice funds are
 * valueless, so no backup gate and a one-tap delete). The host app provides
 * the PracticeStorageBackend implementation.
 */

export const PRACTICE_MODE_KEY = 'practice-state:mode-active';
export const PRACTICE_ADDRESS_INDEXES_KEY = 'practice-state:address-indexes';
export const PRACTICE_STATE_KEYS = [PRACTICE_MODE_KEY, PRACTICE_ADDRESS_INDEXES_KEY];

export type PracticeStorageBackend = {
  getSecret(): Promise<string | null>;
  setSecret(value: string): Promise<void>;
  removeSecret(): Promise<void>;
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<void>;
  removeValue(key: string): Promise<void>;
};

export type PracticeAddressIndexes = {
  /** Number of receive addresses handed out so far (next index to use). */
  external: number;
  /** Number of change addresses used so far (next index to use). */
  change: number;
};

const DEFAULT_INDEXES: PracticeAddressIndexes = { external: 1, change: 0 };

function parseIndexes(raw: string | null): PracticeAddressIndexes {
  if (!raw) return { ...DEFAULT_INDEXES };
  try {
    const parsed = JSON.parse(raw) as Partial<PracticeAddressIndexes>;
    const external = Number(parsed.external);
    const change = Number(parsed.change);
    if (
      Number.isInteger(external) && external >= 1 &&
      Number.isInteger(change) && change >= 0
    ) {
      return { external, change };
    }
  } catch {
    // Corrupt state falls back to defaults; rescanning from index zero is
    // always safe, it only costs a few extra explorer lookups.
  }
  return { ...DEFAULT_INDEXES };
}

export class PracticeWalletStore {
  private readonly backend: PracticeStorageBackend;

  constructor(backend: PracticeStorageBackend) {
    this.backend = backend;
  }

  loadMnemonic(): Promise<string | null> {
    return this.backend.getSecret();
  }

  async hasWallet(): Promise<boolean> {
    return (await this.backend.getSecret()) !== null;
  }

  /**
   * Returns the existing practice mnemonic, or creates one with `generate`.
   * Safe to call repeatedly; the wallet is only ever created once.
   */
  async ensureWallet(generate: () => string): Promise<{ mnemonic: string; created: boolean }> {
    const existing = await this.backend.getSecret();
    if (existing !== null) return { mnemonic: existing, created: false };
    const mnemonic = generate();
    if (!mnemonic.trim()) {
      throw new Error('The practice mnemonic generator returned an empty phrase.');
    }
    await this.backend.setSecret(mnemonic);
    const saved = await this.backend.getSecret();
    if (saved !== mnemonic) {
      throw new Error('The practice wallet seed could not be verified after saving.');
    }
    return { mnemonic, created: true };
  }

  async isModeActive(): Promise<boolean> {
    return (await this.backend.getValue(PRACTICE_MODE_KEY)) === 'true';
  }

  async setModeActive(active: boolean): Promise<void> {
    if (active) {
      await this.backend.setValue(PRACTICE_MODE_KEY, 'true');
    } else {
      await this.backend.removeValue(PRACTICE_MODE_KEY);
    }
  }

  async getAddressIndexes(): Promise<PracticeAddressIndexes> {
    return parseIndexes(await this.backend.getValue(PRACTICE_ADDRESS_INDEXES_KEY));
  }

  async setAddressIndexes(indexes: PracticeAddressIndexes): Promise<void> {
    if (
      !Number.isInteger(indexes.external) || indexes.external < 1 ||
      !Number.isInteger(indexes.change) || indexes.change < 0
    ) {
      throw new Error('Practice address indexes must be non-negative integers.');
    }
    await this.backend.setValue(PRACTICE_ADDRESS_INDEXES_KEY, JSON.stringify(indexes));
  }

  /** Deletes the practice wallet: seed, mode flag and address state. */
  async clear(): Promise<void> {
    await this.backend.removeSecret();
    for (const key of PRACTICE_STATE_KEYS) {
      await this.backend.removeValue(key);
    }
  }
}
