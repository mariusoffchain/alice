// Re-checks every on-chain identifier of the Learn anchor table against
// mempool.space (the Explorer's own data source). Run it whenever the table
// changes; nothing may be merged into learn-anchors.ts without passing here.
//
//   node scripts/verify-learn-anchors.mjs

import { LEARN_CHAPTER_LINKS } from '../packages/alice-content/src/learn-anchors.ts';

const API = 'https://mempool.space/api';
let failures = 0;

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function getJson(url) {
  return JSON.parse(await getText(url));
}

const seen = new Set();
for (const link of LEARN_CHAPTER_LINKS) {
  for (const anchor of link.anchors ?? []) {
    const key = `${anchor.type}:${anchor.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (anchor.type === 'block') {
        if (!/^\d+$/.test(anchor.id)) throw new Error('block anchors use a height');
        const hash = await getText(`${API}/block-height/${anchor.id}`);
        if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`no hash for height ${anchor.id}`);
        console.log(`OK  block ${anchor.id} → ${hash.slice(0, 16)}…`);
      } else if (anchor.type === 'tx') {
        if (!/^[0-9a-f]{64}$/.test(anchor.id)) throw new Error('txid must be 64 hex chars');
        const status = await getJson(`${API}/tx/${anchor.id}/status`);
        if (!status.confirmed) throw new Error('not confirmed');
        if (anchor.expect?.blockHeight !== undefined && status.block_height !== anchor.expect.blockHeight) {
          throw new Error(`block ${status.block_height}, expected ${anchor.expect.blockHeight}`);
        }
        if (anchor.expect?.totalOutSats !== undefined) {
          const tx = await getJson(`${API}/tx/${anchor.id}`);
          const total = tx.vout.reduce((sum, out) => sum + out.value, 0);
          if (total !== anchor.expect.totalOutSats) {
            throw new Error(`total out ${total}, expected ${anchor.expect.totalOutSats}`);
          }
        }
        console.log(`OK  tx ${anchor.id.slice(0, 12)}… (block ${status.block_height})`);
      } else {
        const stats = await getJson(`${API}/address/${anchor.id}`);
        if (!stats.address) throw new Error('unknown address');
        console.log(`OK  address ${anchor.id.slice(0, 12)}…`);
      }
    } catch (error) {
      failures++;
      console.error(`FAIL ${key}: ${error.message}`);
    }
  }
}

console.log(failures ? `\n${failures} ancre(s) en échec.` : '\nToutes les ancres sont vérifiées.');
process.exit(failures ? 1 : 0);
