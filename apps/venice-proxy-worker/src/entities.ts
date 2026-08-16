// Explorer entity lookup, served from D1. The client bundles the small,
// compliance-critical dataset and calls this only for the giant packs it cannot
// ship. Public data: no authentication, no Venice key, no logged bodies.
//
// It reads ENTITY_DB, never ACCOUNT_DB. This endpoint is open to anyone, so the
// database handle it holds is deliberately one that contains no user data.
//
// The response shape mirrors the client's EntityLabel so the two datasets merge
// without translation. Every label is sourced and dated at ingestion time.

import type { Env } from './index.ts';

type EntityLabel = {
  name: string;
  category: string;
  confidence: string;
  source: string;
  sourceLabel: string;
  date: string;
};

type Row = {
  address: string;
  name: string;
  category: string;
  confidence: string;
  source: string;
  source_label: string;
  seen_date: string;
};

// Bech32 is case-insensitive lowercase; base58 is case-sensitive. Normalise only
// the bech32 family so a lookup matches regardless of how it was typed, exactly
// like the client's normalizeAddress.
function normalizeAddress(address: string): string {
  const t = address.trim();
  return /^(bc1|tb1|bcrt1)/i.test(t) ? t.toLowerCase() : t;
}

// A single request may not ask about an unbounded number of addresses: cap it so
// one call cannot turn into a huge IN (...) scan.
const MAX_ADDRESSES = 100;

/**
 * POST { addresses: string[] } -> { labels: { [address]: EntityLabel[] } }.
 * Only addresses that have at least one label appear in the map. Unknown or
 * malformed input yields an empty map rather than an error, so the client's
 * fallback path stays simple.
 */
export async function lookupEntities(request: Request, env: Env): Promise<unknown> {
  if (!env.ENTITY_DB) return { labels: {} };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { labels: {} };
  }

  const raw = (body as { addresses?: unknown })?.addresses;
  if (!Array.isArray(raw)) return { labels: {} };

  // De-duplicate and normalise, keeping a map back to the caller's spelling so
  // the response is keyed the way the client asked.
  const wanted = new Map<string, string>(); // normalized -> original
  for (const a of raw) {
    if (typeof a !== 'string') continue;
    const norm = normalizeAddress(a);
    if (norm && !wanted.has(norm)) wanted.set(norm, a);
    if (wanted.size >= MAX_ADDRESSES) break;
  }
  if (wanted.size === 0) return { labels: {} };

  const norms = [...wanted.keys()];
  const placeholders = norms.map(() => '?').join(',');
  const sql =
    `SELECT address, name, category, confidence, source, source_label, seen_date
     FROM entity_labels WHERE address IN (${placeholders})`;

  let rows: Row[] = [];
  try {
    const res = await env.ENTITY_DB.prepare(sql).bind(...norms).all<Row>();
    rows = res.results ?? [];
  } catch {
    return { labels: {} };
  }

  const labels: Record<string, EntityLabel[]> = {};
  for (const r of rows) {
    const original = wanted.get(r.address) ?? r.address;
    (labels[original] ??= []).push({
      name: r.name,
      category: r.category,
      confidence: r.confidence,
      source: r.source,
      sourceLabel: r.source_label,
      date: r.seen_date,
    });
  }
  return { labels };
}
