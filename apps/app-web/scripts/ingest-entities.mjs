// Ingest public, permissively-licensed entity attribution data into a generated
// dataset the client bundles. Run: node apps/app-web/scripts/ingest-entities.mjs
//
// Sources:
//  - OFAC sanctioned Bitcoin addresses, via the 0xB10C machine-readable mirror of
//    the OFAC SDN list (regenerated from the official list).
//  - GraphSense TagPacks (MIT), a curated set of named Bitcoin packs (exchanges,
//    mixers, darknet), each tag carrying a source URL and a date.
//
// Everything written is public and sourced; nothing is asserted as certain that
// is not backed by its source. The output shape matches EntityRecord in
// src/lib/explorer/entities.ts.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'lib', 'explorer', 'entity-data.generated.ts');
const TODAY = new Date().toISOString().slice(0, 10);

const OFAC_XBT = 'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.txt';
const TAGPACK_BASE = 'https://raw.githubusercontent.com/graphsense/graphsense-tagpacks/master/packs/';

// Curated Bitcoin packs: named exchanges, mixers and darknet markets. The parser
// filters to BTC tags, so a non-BTC tag inside any of these is dropped.
const PACKS = [
  'exchange-wallets-binance.yaml', 'exchange-wallets-bitfinexcom.yaml',
  'exchange-wallets-bitmex_0.yaml', 'exchange-wallets-bybit.yaml',
  'exchange-wallets-cryptocom.yaml', 'exchange-wallets-deribit.yaml',
  'exchange-wallets-huobi.yaml', 'exchange-wallets-kucoin.yaml',
  'exchange-wallets-okx.yaml', 'exchange-wallets-swissborg.yaml',
  'binance.yaml', 'blender_io.yaml', 'hydra.yaml', 'samourai.yaml',
  'wasabi_collector.yaml', 'service-wallets-checksig.yaml',
];

// GraphSense category vocabulary -> our EntityCategory.
function mapCategory(c) {
  const v = (c || '').toLowerCase();
  if (v.includes('exchange')) return 'exchange';
  if (v.includes('mixing') || v.includes('mixer') || v.includes('coinjoin') || v.includes('tumbler')) return 'mixer';
  if (v.includes('payment')) return 'payment';
  if (v.includes('gambling')) return 'gambling';
  if (v.includes('market') || v.includes('darknet')) return 'darknet';
  if (v.includes('mining') || v.includes('pool')) return 'mining';
  if (v.includes('scam') || v.includes('fraud') || v.includes('phishing') || v.includes('ponzi')) return 'scam';
  if (v.includes('p2p') || v.includes('peer')) return 'p2p';
  return 'unknown';
}

// GraphSense confidence vocabulary -> our EntityConfidence.
function mapConfidence(c) {
  const v = (c || '').toLowerCase();
  if (v.includes('authority')) return 'certain';
  if (v.includes('ownership') || v.includes('service')) return 'strong';
  return 'possible';
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// Minimal parser for the regular GraphSense tagpack YAML: header key/values, then
// a `tags:` list of `- address:` items that inherit the header and may override.
function parseTagpack(yaml) {
  const lines = yaml.split('\n');
  const header = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^tags:\s*$/.test(line)) { i++; break; }
    const m = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (m) header[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const tags = [];
  let cur = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const start = line.match(/^\s*-\s*address:\s*(.+)$/);
    if (start) {
      if (cur) tags.push(cur);
      cur = { address: start[1].trim().replace(/^["']|["']$/g, '') };
      continue;
    }
    const kv = line.match(/^\s+([a-z_]+):\s*(.*)$/i);
    if (kv && cur) cur[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  if (cur) tags.push(cur);
  return { header, tags };
}

function recordsFromPack(header, tags) {
  const out = [];
  for (const tag of tags) {
    const currency = (tag.currency || header.currency || '').toUpperCase();
    if (currency && currency !== 'BTC' && currency !== 'XBT') continue;
    const address = tag.address;
    if (!address) continue;
    out.push({
      address,
      name: tag.label || header.label || 'unknown',
      category: mapCategory(tag.category || header.category),
      confidence: mapConfidence(tag.confidence || header.confidence),
      source: tag.source || header.source || TAGPACK_BASE,
      sourceLabel: `GraphSense TagPacks (${header.title || header.label || 'pack'})`,
      date: (tag.lastmod || header.lastmod || TODAY).slice(0, 10),
    });
  }
  return out;
}

async function main() {
  const records = [];
  const seen = new Set();
  const push = (r) => {
    const key = `${r.address}|${r.name}|${r.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push(r);
  };

  // 1) OFAC sanctioned XBT addresses.
  try {
    const txt = await fetchText(OFAC_XBT);
    const addrs = txt.split('\n').map(s => s.trim()).filter(Boolean);
    for (const address of addrs) {
      push({
        address,
        name: 'OFAC-sanctioned entity',
        category: 'sanctioned',
        confidence: 'certain',
        source: 'https://sanctionssearch.ofac.treas.gov/',
        sourceLabel: 'OFAC SDN list (via 0xB10C)',
        date: TODAY,
      });
    }
    console.log(`OFAC XBT: ${addrs.length} addresses`);
  } catch (e) {
    console.warn('OFAC fetch failed:', e.message);
  }

  // 2) GraphSense named BTC packs. Enormous packs (e.g. an exchange's tens of
  // thousands of enumerated reserve addresses) are skipped here: bundling them
  // client-side is the wrong tool, they belong to the server-backed provider.
  const MAX_PER_PACK = 2000;
  for (const pack of PACKS) {
    try {
      const yaml = await fetchText(TAGPACK_BASE + pack);
      const { header, tags } = parseTagpack(yaml);
      const recs = recordsFromPack(header, tags);
      if (recs.length > MAX_PER_PACK) {
        console.log(`${pack}: ${recs.length} tags, SKIPPED (too large for the client bundle; server-side later)`);
        continue;
      }
      recs.forEach(push);
      console.log(`${pack}: ${recs.length} BTC tags (${header.label || header.title})`);
    } catch (e) {
      console.warn(`${pack} failed:`, e.message);
    }
  }

  records.sort((a, b) => a.address.localeCompare(b.address) || a.name.localeCompare(b.name));

  const body = `// GENERATED by scripts/ingest-entities.mjs on ${TODAY}. Do not edit by hand.
// Sources: OFAC SDN (public) via 0xB10C; GraphSense TagPacks (MIT).
import type { EntityRecord } from './entities.ts';

export const GENERATED_ENTITY_RECORDS: EntityRecord[] = ${JSON.stringify(records, null, 0)};
`;
  await writeFile(OUT, body, 'utf8');
  console.log(`\nWrote ${records.length} records to ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
