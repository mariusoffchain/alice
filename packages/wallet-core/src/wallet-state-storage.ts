import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';
import type { SatoraKeyValueStore } from './satora-storage';
import type { EmergencyExitState } from './wallet-backend';

const ENVELOPE_PREFIX = 'alice-wallet-state:v1';
const NONCE_BYTES = 12;
const KEY_SALT = utf8ToBytes('alice-wallet-state-storage-v1');
const KEY_INFO = utf8ToBytes('vtxo-lifecycle-and-emergency-exit');
const EXCLUSIONS_KEY = 'wallet-state:vtxo-exclusions';
const FROZEN_VTXOS_KEY = 'wallet-state:frozen-vtxos';
const RECEIVE_ADDRESSES_KEY = 'wallet-state:receive-addresses';
const RECEIVE_ROTATION_KEY = 'wallet-state:receive-rotation';
const EMERGENCY_EXIT_KEY = 'wallet-state:emergency-exit';
const EMERGENCY_EXIT_STAGES = new Set([
  'idle',
  'ready',
  'needs-fee-funding',
  'unrolling',
  'waiting-confirmation',
  'waiting-timelock',
  'completing',
  'completed',
  'failed',
]);

export interface VtxoExclusion {
  id: string;
  reason: string;
  excludedAt: number;
}

export interface FrozenVtxo {
  id: string;
  frozenAt: number;
}

export type ReceiveAddressLayer = 'arkade' | 'onchain';

export interface ReceiveAddressRecord {
  address: string;
  layer: ReceiveAddressLayer;
  label: string;
  shared: boolean;
  used: boolean;
  current: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEmergencyExitState(value: unknown): value is EmergencyExitState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<EmergencyExitState>;
  return state.version === 1
    && typeof state.stage === 'string'
    && EMERGENCY_EXIT_STAGES.has(state.stage)
    && typeof state.destination === 'string'
    && isStringArray(state.selectedIds)
    && isFiniteNumber(state.selectedAmountSats)
    && state.selectedAmountSats >= 0
    && typeof state.feeAddress === 'string'
    && isFiniteNumber(state.feeBalanceSats)
    && state.feeBalanceSats >= 0
    && isStringArray(state.completedVtxoIds)
    && isOptionalString(state.currentVtxoId)
    && isOptionalString(state.currentTxid)
    && isOptionalString(state.finalTxid)
    && isOptionalString(state.error)
    && isFiniteNumber(state.createdAt)
    && isFiniteNumber(state.updatedAt);
}

function deriveStorageKey(mnemonic: string): Uint8Array {
  if (!mnemonic.trim()) throw new Error('Wallet state storage requires the recovery phrase.');
  return hkdf(
    sha256,
    utf8ToBytes(mnemonic.normalize('NFKD')),
    KEY_SALT,
    KEY_INFO,
    32,
  );
}

function parseEnvelope(value: string): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const parts = value.split(':');
  if (
    parts.length !== 4
    || `${parts[0]}:${parts[1]}` !== ENVELOPE_PREFIX
    || !/^[0-9a-f]{24}$/i.test(parts[2] ?? '')
    || !/^[0-9a-f]+$/i.test(parts[3] ?? '')
  ) {
    throw new Error('Wallet state contains an invalid encrypted record.');
  }
  return {
    nonce: hexToBytes(parts[2]),
    ciphertext: hexToBytes(parts[3]),
  };
}

export class WalletStateStorage {
  private readonly encryptionKey: Uint8Array;
  private readonly values: SatoraKeyValueStore;
  private mutation = Promise.resolve();

  constructor(mnemonic: string, values: SatoraKeyValueStore) {
    this.encryptionKey = deriveStorageKey(mnemonic);
    this.values = values;
  }

  private async get<T>(key: string): Promise<T | null> {
    const encrypted = await this.values.get(key);
    if (encrypted === null) return null;
    const { nonce, ciphertext } = parseEnvelope(encrypted);
    let plaintext: Uint8Array;
    try {
      plaintext = gcm(this.encryptionKey, nonce, utf8ToBytes(key)).decrypt(ciphertext);
    } catch {
      throw new Error('Wallet state could not authenticate an encrypted record.');
    }
    try {
      return JSON.parse(new TextDecoder().decode(plaintext)) as T;
    } catch {
      throw new Error('Wallet state contains an unreadable record.');
    }
  }

  private async set(key: string, value: unknown): Promise<void> {
    const nonce = randomBytes(NONCE_BYTES);
    const ciphertext = gcm(
      this.encryptionKey,
      nonce,
      utf8ToBytes(key),
    ).encrypt(utf8ToBytes(JSON.stringify(value)));
    await this.values.set(
      key,
      `${ENVELOPE_PREFIX}:${bytesToHex(nonce)}:${bytesToHex(ciphertext)}`,
    );
  }

  async getExclusions(): Promise<VtxoExclusion[]> {
    await this.mutation;
    const exclusions = await this.get<unknown>(EXCLUSIONS_KEY);
    if (!Array.isArray(exclusions)) return [];
    return exclusions.filter((value): value is VtxoExclusion => {
      if (!value || typeof value !== 'object') return false;
      const item = value as Partial<VtxoExclusion>;
      return typeof item.id === 'string'
        && typeof item.reason === 'string'
        && Number.isFinite(item.excludedAt);
    });
  }

  setExclusion(id: string, reason: string): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.getExclusionsUnlocked();
      const next = current.filter(item => item.id !== id);
      next.push({ id, reason, excludedAt: Date.now() });
      await this.set(EXCLUSIONS_KEY, next);
    });
  }

  removeExclusions(ids: readonly string[]): Promise<string[]> {
    return this.enqueue(async () => {
      const remove = new Set(ids);
      const current = await this.getExclusionsUnlocked();
      const removed = current.filter(item => remove.has(item.id)).map(item => item.id);
      if (removed.length > 0) {
        await this.set(EXCLUSIONS_KEY, current.filter(item => !remove.has(item.id)));
      }
      return removed;
    });
  }

  async getFrozenVtxos(): Promise<FrozenVtxo[]> {
    await this.mutation;
    return this.getFrozenVtxosUnlocked();
  }

  setVtxoFrozen(id: string, frozen: boolean): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.getFrozenVtxosUnlocked();
      const next = current.filter(item => item.id !== id);
      if (frozen) next.push({ id, frozenAt: Date.now() });
      await this.set(FROZEN_VTXOS_KEY, next);
    });
  }

  removeFrozenVtxos(ids: readonly string[]): Promise<string[]> {
    return this.enqueue(async () => {
      const remove = new Set(ids);
      const current = await this.getFrozenVtxosUnlocked();
      const removed = current.filter(item => remove.has(item.id)).map(item => item.id);
      if (removed.length > 0) {
        await this.set(FROZEN_VTXOS_KEY, current.filter(item => !remove.has(item.id)));
      }
      return removed;
    });
  }

  async getReceiveAddresses(): Promise<ReceiveAddressRecord[]> {
    await this.mutation;
    return this.getReceiveAddressesUnlocked();
  }

  upsertReceiveAddress(
    input: Omit<ReceiveAddressRecord, 'createdAt' | 'updatedAt' | 'archived'> & {
      archived?: boolean;
    },
  ): Promise<ReceiveAddressRecord> {
    return this.enqueue(async () => {
      const current = await this.getReceiveAddressesUnlocked();
      const now = Date.now();
      const existing = current.find(item => item.address === input.address);
      const record: ReceiveAddressRecord = {
        ...input,
        archived: input.archived ?? existing?.archived ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const next = current
        .filter(item => item.address !== input.address)
        .map(item => input.current && item.layer === input.layer
          ? { ...item, current: false, updatedAt: now }
          : item);
      next.push(record);
      await this.set(RECEIVE_ADDRESSES_KEY, next);
      return record;
    });
  }

  updateReceiveAddress(
    address: string,
    patch: Partial<Pick<ReceiveAddressRecord, 'label' | 'shared' | 'used' | 'current' | 'archived'>>,
  ): Promise<ReceiveAddressRecord> {
    return this.enqueue(async () => {
      const current = await this.getReceiveAddressesUnlocked();
      const existing = current.find(item => item.address === address);
      if (!existing) throw new Error('Receive address is not registered.');
      const now = Date.now();
      const updated = { ...existing, ...patch, updatedAt: now };
      const next = current.map(item => {
        if (item.address === address) return updated;
        if (patch.current && item.layer === existing.layer) {
          return { ...item, current: false, updatedAt: now };
        }
        return item;
      });
      await this.set(RECEIVE_ADDRESSES_KEY, next);
      return updated;
    });
  }

  async getEmergencyExit(): Promise<EmergencyExitState | null> {
    await this.mutation;
    const state = await this.get<unknown>(EMERGENCY_EXIT_KEY);
    if (state === null) return null;
    if (!isEmergencyExitState(state)) {
      throw new Error('Wallet state contains an invalid emergency exit record.');
    }
    return state;
  }

  setEmergencyExit(state: EmergencyExitState): Promise<void> {
    return this.enqueue(() => this.set(EMERGENCY_EXIT_KEY, state));
  }

  clearEmergencyExit(): Promise<void> {
    return this.enqueue(() => this.values.delete(EMERGENCY_EXIT_KEY));
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await Promise.all([
        this.values.delete(EXCLUSIONS_KEY),
        this.values.delete(FROZEN_VTXOS_KEY),
        this.values.delete(RECEIVE_ADDRESSES_KEY),
        this.values.delete(RECEIVE_ROTATION_KEY),
        this.values.delete(EMERGENCY_EXIT_KEY),
      ]);
    });
  }

  private async getExclusionsUnlocked(): Promise<VtxoExclusion[]> {
    const exclusions = await this.get<unknown>(EXCLUSIONS_KEY);
    if (!Array.isArray(exclusions)) return [];
    return exclusions.filter((value): value is VtxoExclusion => {
      if (!value || typeof value !== 'object') return false;
      const item = value as Partial<VtxoExclusion>;
      return typeof item.id === 'string'
        && typeof item.reason === 'string'
        && Number.isFinite(item.excludedAt);
    });
  }

  private async getFrozenVtxosUnlocked(): Promise<FrozenVtxo[]> {
    const frozen = await this.get<unknown>(FROZEN_VTXOS_KEY);
    if (!Array.isArray(frozen)) return [];
    return frozen.filter((value): value is FrozenVtxo => {
      if (!value || typeof value !== 'object') return false;
      const item = value as Partial<FrozenVtxo>;
      return typeof item.id === 'string' && Number.isFinite(item.frozenAt);
    });
  }

  private async getReceiveAddressesUnlocked(): Promise<ReceiveAddressRecord[]> {
    const addresses = await this.get<unknown>(RECEIVE_ADDRESSES_KEY);
    if (!Array.isArray(addresses)) return [];
    return addresses.flatMap((value): ReceiveAddressRecord[] => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Partial<ReceiveAddressRecord>;
      const valid = typeof item.address === 'string'
        && (item.layer === 'arkade' || item.layer === 'onchain')
        && typeof item.label === 'string'
        && typeof item.shared === 'boolean'
        && typeof item.used === 'boolean'
        && typeof item.current === 'boolean'
        && Number.isFinite(item.createdAt)
        && Number.isFinite(item.updatedAt);
      if (!valid) return [];
      return [{ ...item, archived: item.archived === true } as ReceiveAddressRecord];
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(() => {}, () => {});
    return result;
  }
}
