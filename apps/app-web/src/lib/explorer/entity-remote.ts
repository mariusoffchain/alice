// Client for the server-side entity lookup (the giant packs the app does not
// bundle). It queries Alice's Worker on demand and merges the result with the
// local StaticEntityStore; every failure path degrades to "no remote labels",
// so entity attribution keeps working offline from the bundled set alone.
//
// Contract 1.3 is unchanged: names stay on the device. This only fetches more
// sourced labels; nothing about the address is sent anywhere except the address
// being viewed, to Alice's own Worker (never a third party).

import type { EntityCategory } from './audit-core.ts';
import type { EntityConfidence, EntityLabel } from './entities.ts';

const CATEGORIES: ReadonlySet<string> = new Set<EntityCategory>([
  'exchange', 'payment', 'gambling', 'scam', 'darknet',
  'mining', 'mixer', 'p2p', 'asp', 'sanctioned', 'unknown',
]);
const CONFIDENCES: ReadonlySet<string> = new Set<EntityConfidence>(['certain', 'strong', 'possible']);

function coerceLabel(v: unknown): EntityLabel | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || typeof o.source !== 'string') return null;
  if (typeof o.sourceLabel !== 'string' || typeof o.date !== 'string') return null;
  const category: EntityCategory = CATEGORIES.has(o.category as string) ? (o.category as EntityCategory) : 'unknown';
  const confidence: EntityConfidence = CONFIDENCES.has(o.confidence as string) ? (o.confidence as EntityConfidence) : 'possible';
  return { name: o.name, category, confidence, source: o.source, sourceLabel: o.sourceLabel, date: o.date };
}

/** The Worker base URL, baked in at build time (see next.config env). Empty when
 *  no proxy is configured, in which case the remote lookup is a no-op. */
function proxyBase(): string {
  return (process.env.EXPO_PUBLIC_VENICE_PROXY_URL ?? '').replace(/\/+$/, '');
}

/** True when a remote lookup can run at all (a proxy is configured). */
export function remoteEntitiesConfigured(): boolean {
  return proxyBase().length > 0;
}

/**
 * Look up several addresses at once against the Worker. Returns a map from the
 * requested address to its labels; addresses with no server label are absent.
 * Any error (offline, no proxy, bad response) resolves to an empty map.
 */
export async function remoteEntityLookup(
  addresses: readonly string[],
  opts: { signal?: AbortSignal } = {},
): Promise<Map<string, EntityLabel[]>> {
  const out = new Map<string, EntityLabel[]>();
  const base = proxyBase();
  if (!base || addresses.length === 0) return out;

  try {
    const res = await fetch(`${base}/explorer/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: [...addresses] }),
      signal: opts.signal ?? AbortSignal.timeout(8000),
    });
    if (!res.ok) return out;
    const json: unknown = await res.json();
    const labels = (json as { labels?: unknown })?.labels;
    if (typeof labels !== 'object' || labels === null) return out;
    for (const [address, raw] of Object.entries(labels as Record<string, unknown>)) {
      if (!Array.isArray(raw)) continue;
      const coerced = raw.map(coerceLabel).filter((l): l is EntityLabel => l !== null);
      if (coerced.length > 0) out.set(address, coerced);
    }
  } catch {
    // Offline, aborted, or malformed: the bundled dataset still stands.
  }
  return out;
}

/** Merge two label lists, dropping duplicates on (name, source). Local labels
 *  win ordering (they are shown first), remote ones are appended. */
export function mergeLabels(local: readonly EntityLabel[], remote: readonly EntityLabel[]): EntityLabel[] {
  const seen = new Set(local.map(l => `${l.name}|${l.source}`));
  const merged = [...local];
  for (const r of remote) {
    const key = `${r.name}|${r.source}`;
    if (!seen.has(key)) { seen.add(key); merged.push(r); }
  }
  return merged;
}
