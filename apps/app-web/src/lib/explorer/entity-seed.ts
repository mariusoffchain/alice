// The seed entity dataset. This is intentionally tiny and hand-verified: the
// bulk data (GraphSense TagPacks MIT, OFAC SDN) is pulled in by an ingestion step
// that generates records in this exact shape. Every entry here is sourced and
// dated; nothing is asserted as certain that is not provable from the chain.

import { StaticEntityStore, type EntityRecord } from './entities.ts';
import { GENERATED_ENTITY_RECORDS } from './entity-data.generated.ts';

const RECORDED = '2026-08-13';

// Hand-verified entries, merged with the generated dataset (OFAC + GraphSense).
export const ENTITY_SEED: EntityRecord[] = [
  {
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    name: 'Satoshi Nakamoto (genesis coinbase)',
    category: 'unknown',
    // Provable from the chain: this is the coinbase output of block 0. That the
    // owner is "Satoshi" is the strong, standard attribution, not a certainty.
    confidence: 'strong',
    source: 'https://en.bitcoin.it/wiki/Genesis_block',
    sourceLabel: 'Bitcoin Wiki: Genesis block',
    date: RECORDED,
  },
];

// The app-wide store: the hand-verified seed plus the generated public datasets
// (OFAC sanctioned addresses, GraphSense named packs). Swapped for a server-backed
// EntityProvider later without changing the EntityStore interface.
export const explorerEntityStore = new StaticEntityStore([...ENTITY_SEED, ...GENERATED_ENTITY_RECORDS]);
