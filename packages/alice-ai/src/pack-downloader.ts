import { sha256 } from '@noble/hashes/sha2.js';
import { registerPack, unregisterPack, type KnowledgePack } from './knowledge-packs.ts';
import * as defaultStorage from './pack-storage.ts';

export type PackDescriptor = {
  id: string;
  title: string;
  description: string;
  /** Approximate download size, for display before the user commits to it. */
  sizeBytes: number;
  language: KnowledgePack['language'];
  version: string;
  url: string;
  /** Lowercase hex SHA-256 of the exact bytes served at `url`. */
  sha256: string;
};

export type PackStorage = {
  readPackIndex: () => Promise<string[]>;
  readPackData: (packId: string) => Promise<string | null>;
  writePackData: (packId: string, data: string) => Promise<void>;
  deletePackData: (packId: string) => Promise<void>;
  readLastCheckedAt: () => Promise<number | null>;
  writeLastCheckedAt: (timestamp: number) => Promise<void>;
};

export class PackIntegrityError extends Error {
  constructor(packId: string) {
    super(`Downloaded pack "${packId}" failed integrity verification and was discarded.`);
    this.name = 'PackIntegrityError';
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function parsePack(raw: string): KnowledgePack {
  const parsed = JSON.parse(raw);
  if (
    typeof parsed !== 'object' || parsed === null
    || typeof parsed.id !== 'string'
    || typeof parsed.version !== 'string'
    || !Array.isArray(parsed.chunks)
  ) {
    throw new Error('Malformed knowledge pack payload.');
  }
  return {
    id: parsed.id,
    version: parsed.version,
    language: parsed.language ?? 'multi',
    source: 'downloaded',
    chunks: parsed.chunks,
  };
}

/**
 * Downloads a pack, verifies it byte-for-byte against the descriptor's SHA-256
 * before trusting any of its content, persists it, and registers it for
 * retrieval. Throws PackIntegrityError rather than silently degrading if the
 * hash does not match, a corrupted or tampered pack must never be used.
 */
export async function downloadPack(
  descriptor: PackDescriptor,
  onProgress?: (fraction: number) => void,
  storage: PackStorage = defaultStorage,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(descriptor.url);
  if (!response.ok) {
    throw new Error(`Pack download failed (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  const digest = toHex(sha256(new Uint8Array(buffer)));
  if (digest !== descriptor.sha256.toLowerCase()) {
    throw new PackIntegrityError(descriptor.id);
  }
  onProgress?.(1);

  const raw = new TextDecoder().decode(buffer);
  const pack = parsePack(raw);
  if (pack.id !== descriptor.id) {
    throw new Error(`Pack payload id "${pack.id}" does not match descriptor id "${descriptor.id}".`);
  }

  await storage.writePackData(descriptor.id, raw);
  registerPack(pack);
}

export async function deletePack(packId: string, storage: PackStorage = defaultStorage): Promise<void> {
  await storage.deletePackData(packId);
  unregisterPack(packId);
}

export async function listDownloadedPackIds(storage: PackStorage = defaultStorage): Promise<string[]> {
  return storage.readPackIndex();
}

/** Re-registers every previously downloaded pack. Call once on app startup. */
export async function restoreDownloadedPacks(storage: PackStorage = defaultStorage): Promise<void> {
  const ids = await storage.readPackIndex();
  for (const id of ids) {
    const raw = await storage.readPackData(id);
    if (!raw) continue;
    try {
      registerPack(parsePack(raw));
    } catch {
      // A pack file that no longer parses is dropped rather than left to
      // crash retrieval on every future launch.
      await storage.deletePackData(id);
    }
  }
}

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type PackUpdateResult = {
  checked: boolean;
  updated: string[];
  failed: string[];
};

/**
 * Silently refreshes packs the user already downloaded, at most once per
 * `intervalMs`. This never fetches a pack the user did not already opt into,
 * and it never asks a server which packs are relevant to a query, the
 * client just compares the version it already has to the catalog's, so the
 * "blind proxy" privacy model (see docs/security/private-cloud-e2ee.md) is
 * unaffected. A failed refresh keeps the previous, still-valid pack in place.
 */
export async function checkForPackUpdates(
  catalog: PackDescriptor[],
  options: { intervalMs?: number; now?: number } = {},
  storage: PackStorage = defaultStorage,
  fetchImpl: typeof fetch = fetch,
): Promise<PackUpdateResult> {
  const now = options.now ?? Date.now();
  const intervalMs = options.intervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;

  const lastCheckedAt = await storage.readLastCheckedAt();
  if (lastCheckedAt !== null && now - lastCheckedAt < intervalMs) {
    return { checked: false, updated: [], failed: [] };
  }

  const downloadedIds = new Set(await storage.readPackIndex());
  const updated: string[] = [];
  const failed: string[] = [];

  for (const descriptor of catalog) {
    if (!downloadedIds.has(descriptor.id)) continue;
    const raw = await storage.readPackData(descriptor.id);
    if (!raw) continue;
    let currentVersion: string | null = null;
    try {
      currentVersion = parsePack(raw).version;
    } catch {
      currentVersion = null;
    }
    if (currentVersion === descriptor.version) continue;

    try {
      await downloadPack(descriptor, undefined, storage, fetchImpl);
      updated.push(descriptor.id);
    } catch {
      // Keep the previous pack; retry on the next scheduled check rather
      // than surfacing a disruptive error for a background refresh.
      failed.push(descriptor.id);
    }
  }

  await storage.writeLastCheckedAt(now);
  return { checked: true, updated, failed };
}
