// Build the server-side entity dataset for Explorer and emit a D1 SQL file.
// This is the COMPLETE set, including the giant enumerated packs the client
// cannot bundle (an exchange's reserve addresses, a large CoinJoin pack). The
// small compliance-critical set still ships in the client bundle separately;
// this table is the superset queried on demand.
//
// Run (from apps/venice-proxy-worker):
//   node scripts/ingest-entities-d1.mjs
//   npx wrangler d1 execute alice-entities --remote --file=entities.d1.sql
//
// Sources (public, permissively licensed):
//   - OFAC sanctioned XBT addresses, via the 0xB10C machine-readable mirror.
//   - GraphSense TagPacks (MIT), named Bitcoin packs.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'entities.d1.sql');
const TODAY = new Date().toISOString().slice(0, 10);

const OFAC_XBT = 'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.txt';
const TAGPACK_BASE = 'https://raw.githubusercontent.com/graphsense/graphsense-tagpacks/master/packs/';

// The giant packs belong here (they are the reason the server exists), plus the
// named ones so this table is a complete superset of the client bundle.
const PACKS = [
  'exchange-wallets-binance.yaml', 'exchange-wallets-bitfinexcom.yaml',
  'exchange-wallets-bitmex_0.yaml', 'exchange-wallets-bybit.yaml',
  'exchange-wallets-cryptocom.yaml', 'exchange-wallets-deribit.yaml',
  'exchange-wallets-huobi.yaml', 'exchange-wallets-kucoin.yaml',
  'exchange-wallets-okx.yaml', 'exchange-wallets-swissborg.yaml',
  'binance.yaml', 'blender_io.yaml', 'hydra.yaml', 'samourai.yaml',
  'wasabi_collector.yaml', 'service-wallets-checksig.yaml',
];

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

function mapConfidence(c) {
  const v = (c || '').toLowerCase();
  if (v.includes('authority')) return 'certain';
  if (v.includes('ownership') || v.includes('service')) return 'strong';
  return 'possible';
}

// Bech32 is case-insensitive lowercase; base58 is case-sensitive. Store the
// normalised form so the Worker's lookup (same rule) matches.
function normalizeAddress(address) {
  const t = address.trim();
  return /^(bc1|tb1|bcrt1)/i.test(t) ? t.toLowerCase() : t;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseTagpack(yaml) {
  const lines = yaml.split('\n');
  const header = {};
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^tags:\s*$/.test(lines[i])) { i++; break; }
    const m = lines[i].match(/^([a-z_]+):\s*(.*)$/i);
    if (m) header[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const tags = [];
  let cur = null;
  for (; i < lines.length; i++) {
    const start = lines[i].match(/^\s*-\s*address:\s*(.+)$/);
    if (start) {
      if (cur) tags.push(cur);
      cur = { address: start[1].trim().replace(/^["']|["']$/g, '') };
      continue;
    }
    const kv = lines[i].match(/^\s+([a-z_]+):\s*(.*)$/i);
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
    if (!tag.address) continue;
    out.push({
      address: normalizeAddress(tag.address),
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

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

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
    for (const address of txt.split('\n').map(s => s.trim()).filter(Boolean)) {
      push({
        address: normalizeAddress(address),
        name: 'OFAC-sanctioned entity',
        category: 'sanctioned',
        confidence: 'certain',
        source: 'https://sanctionssearch.ofac.treas.gov/',
        sourceLabel: 'OFAC SDN list (via 0xB10C)',
        date: TODAY,
      });
    }
    console.log(`OFAC XBT: ok`);
  } catch (e) {
    console.warn('OFAC fetch failed:', e.message);
  }

  // 2) Every GraphSense named BTC pack, giants INCLUDED (that is the point).
  for (const pack of PACKS) {
    try {
      const { header, tags } = parseTagpack(await fetchText(TAGPACK_BASE + pack));
      const recs = recordsFromPack(header, tags);
      recs.forEach(push);
      console.log(`${pack}: ${recs.length} BTC tags`);
    } catch (e) {
      console.warn(`${pack} failed:`, e.message);
    }
  }

  records.sort((a, b) => a.address.localeCompare(b.address) || a.name.localeCompare(b.name));

  // Batch multi-row INSERTs so `wrangler d1 execute --file` stays within D1's
  // per-statement limits. INSERT OR REPLACE makes re-ingestion idempotent.
  //
  // 400 rows per statement was rejected with SQLITE_TOOBIG on the first real
  // load: rows carry a long source label as well as the address, so the cap
  // that matters is bytes, not rows. 50 keeps each statement around 10 kB.
  const BATCH = 50;
  const lines = [
    '-- GENERATED by scripts/ingest-entities-d1.mjs on ' + TODAY + '. Do not edit by hand.',
    '-- Apply: npx wrangler d1 execute alice-entities --remote --file=entities.d1.sql',
    '',
  ];
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    const values = chunk.map(r =>
      `(${q(r.address)},${q(r.name)},${q(r.category)},${q(r.confidence)},${q(r.source)},${q(r.sourceLabel)},${q(r.date)})`,
    ).join(',\n');
    lines.push(
      'INSERT OR REPLACE INTO entity_labels (address, name, category, confidence, source, source_label, seen_date) VALUES',
      values + ';',
      '',
    );
  }

  await writeFile(OUT, lines.join('\n'), 'utf8');
  console.log(`\nWrote ${records.length} records to ${OUT}`);
  console.log('Next: npx wrangler d1 execute alice-entities --remote --file=entities.d1.sql');
}

main().catch(err => { console.error(err); process.exit(1); });
