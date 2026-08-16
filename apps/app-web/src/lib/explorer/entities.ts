// Entity attribution: turning a raw address into "probably belongs to X". This
// is a privacy-audit input, not surveillance: seeing that a coin touched a known
// exchange, service or sanctioned cluster is exactly what tells a user how
// exposed they are, so they can act. Every label is therefore sourced, dated and
// confidence-qualified ("probably"), never asserted as certain by us.
//
// Data comes from permissively-licensed, public sources aggregated behind this
// store (GraphSense TagPacks MIT, OFAC SDN public, curated community sets). Names
// stay local by default (contract 1.3): only the category is eligible to reach
// the AI unless the user explicitly opts the name in.

import type { EntityCategory } from './audit-core.ts';

export type { EntityCategory };

// How sure the SOURCE is about the mapping. Kept separate from severity, like
// PrivacySignal.confidence. Never 100%: attribution is inference, not proof.
export type EntityConfidence = 'certain' | 'strong' | 'possible';

/** A sourced, dated attribution of an address to a real-world entity. */
export type EntityLabel = {
  name: string;
  category: EntityCategory;
  confidence: EntityConfidence;
  /** Dereferenceable link to where this mapping comes from. */
  source: string;
  sourceLabel: string;
  /** ISO date the mapping was recorded or last verified. */
  date: string;
};

export type EntityRecord = EntityLabel & { address: string };

export interface EntityStore {
  /** Every label known for an address, strongest confidence first. */
  lookupAddress(address: string): EntityLabel[];
  /** How many address→entity mappings are loaded (for a data-source note). */
  readonly size: number;
}

const CONFIDENCE_RANK: Record<EntityConfidence, number> = { certain: 3, strong: 2, possible: 1 };

// Bech32 is case-insensitive lowercase; base58 is case-sensitive. Normalise only
// the bech32 family so a lookup matches regardless of how it was typed.
function normalizeAddress(address: string): string {
  const t = address.trim();
  return /^(bc1|tb1|bcrt1)/i.test(t) ? t.toLowerCase() : t;
}

/** Order labels strongest-first, then break ties by name for a stable render. */
export function sortLabels(labels: readonly EntityLabel[]): EntityLabel[] {
  return [...labels].sort(
    (a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || a.name.localeCompare(b.name),
  );
}

// A simple in-memory store over a bundled dataset. The real datasets (TagPacks,
// OFAC) are generated into this shape by an ingestion step; the interface stays
// the same, so a server-backed EntityProvider can later replace it wholesale.
export class StaticEntityStore implements EntityStore {
  private readonly byAddress = new Map<string, EntityLabel[]>();

  constructor(records: readonly EntityRecord[]) {
    for (const r of records) {
      const key = normalizeAddress(r.address);
      const { address: _address, ...label } = r;
      const list = this.byAddress.get(key);
      if (list) list.push(label);
      else this.byAddress.set(key, [label]);
    }
  }

  lookupAddress(address: string): EntityLabel[] {
    const labels = this.byAddress.get(normalizeAddress(address));
    return labels ? sortLabels(labels) : [];
  }

  get size(): number {
    return this.byAddress.size;
  }
}
