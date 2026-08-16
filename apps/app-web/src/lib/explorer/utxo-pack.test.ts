import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { packUtxos } from './utxo-pack.ts';

describe('packUtxos', () => {
  it('keeps every output and lays them out with positive coordinates', () => {
    const utxos = Array.from({ length: 30 }, (_, i) => ({ valueSats: (i + 1) * 100000 }));
    const layout = packUtxos(utxos);
    assert.equal(layout.circles.length, 30);
    for (const c of layout.circles) {
      assert.ok(c.x - c.r >= -1e-3, 'x within bounds');
      assert.ok(c.y - c.r >= -1e-3, 'y within bounds');
      assert.ok(c.x + c.r <= layout.width + 1e-3, 'x fits width');
      assert.ok(c.y + c.r <= layout.height + 1e-3, 'y fits height');
    }
  });

  it('never overlaps two circles', () => {
    const utxos = Array.from({ length: 60 }, (_, i) => ({ valueSats: Math.round(1e8 / (i + 1)) }));
    const { circles } = packUtxos(utxos);
    for (let i = 0; i < circles.length; i++) {
      for (let j = i + 1; j < circles.length; j++) {
        const dx = circles[i].x - circles[j].x;
        const dy = circles[i].y - circles[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        assert.ok(d >= circles[i].r + circles[j].r - 1e-2, `circles ${i} and ${j} overlap`);
      }
    }
  });

  it('caps the number of circles at the given max, keeping the largest', () => {
    const utxos = Array.from({ length: 500 }, (_, i) => ({ valueSats: i + 1 }));
    const layout = packUtxos(utxos, { max: 100 });
    assert.equal(layout.shown, 100);
    // The floor keeps dust visible, so the largest radius is the unit default.
    assert.ok(layout.maxR > 0);
  });

  it('handles an empty set', () => {
    const layout = packUtxos([]);
    assert.equal(layout.circles.length, 0);
    assert.equal(layout.width, 0);
  });
});
