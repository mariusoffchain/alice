import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectEntityLink } from './entity-signal.ts';
import { toAbstractSignal } from './audit-core.ts';
import type { EntityLabel } from './entities.ts';

function label(over: Partial<EntityLabel>): EntityLabel {
  return { name: 'Acme', category: 'exchange', confidence: 'strong', source: 'https://s', sourceLabel: 's', date: '2026-01-01', ...over };
}

describe('detectEntityLink', () => {
  it('returns nothing when the address is unknown', () => {
    assert.deepEqual(detectEntityLink('bc1qx', []), []);
  });

  it('flags a sanctioned link as high severity and keeps the name only in detail', () => {
    const sigs = detectEntityLink('3blender', [
      label({ name: 'Blender.io', category: 'mixer', confidence: 'certain' }),
      label({ name: 'OFAC-sanctioned entity', category: 'sanctioned', confidence: 'certain' }),
    ]);
    assert.equal(sigs.length, 1);
    assert.equal(sigs[0].ruleId, 'ENTITY_LINK');
    assert.equal(sigs[0].severity, 'high');
    assert.equal(sigs[0].confidence, 'certain');
    assert.match(sigs[0].detail, /Blender\.io/);
    // The evidence carries categories only, never the name.
    assert.equal(sigs[0].evidence.categories, 'mixer,sanctioned');
    assert.ok(!JSON.stringify(sigs[0].evidence).includes('Blender'));
  });

  it('an exchange link is medium severity', () => {
    const sigs = detectEntityLink('1binance', [label({ name: 'binance.com', category: 'exchange' })]);
    assert.equal(sigs[0].severity, 'medium');
  });

  it('projects to an AbstractSignal with categories only, no name', () => {
    const [sig] = detectEntityLink('3blender', [
      label({ name: 'Blender.io', category: 'mixer', confidence: 'certain' }),
      label({ name: 'OFAC-sanctioned entity', category: 'sanctioned', confidence: 'certain' }),
    ]);
    const abstract = toAbstractSignal(sig);
    assert.ok(abstract);
    assert.deepEqual(abstract.entityCategories, ['mixer', 'sanctioned']);
    const json = JSON.stringify(abstract);
    assert.ok(!json.includes('Blender'), 'name never crosses');
    assert.ok(!json.includes('3blender'), 'address never crosses');
  });
});
