import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { packBlockGrid } from './treemap.ts';

describe('packBlockGrid', () => {
  it('returns nothing for no input', () => {
    const g = packBlockGrid([]);
    assert.equal(g.rows, 0);
    assert.deepEqual(g.squares, []);
  });

  it('keeps one square per input and preserves original indices', () => {
    const g = packBlockGrid([400, 200, 900, 1600], 40);
    assert.equal(g.squares.length, 4);
    assert.deepEqual([...g.squares.map(s => s.index)].sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  it('gives a bigger transaction a bigger integer grid size', () => {
    const g = packBlockGrid([10000, 100], 40);
    const byIndex = new Map(g.squares.map(s => [s.index, s.s]));
    assert.ok(byIndex.get(0)! > byIndex.get(1)!);
    assert.ok(Number.isInteger(byIndex.get(0)!));
  });

  it('keeps every square inside the grid width', () => {
    const g = packBlockGrid(Array.from({ length: 200 }, (_, i) => 100 + i * 37), 40);
    for (const sq of g.squares) {
      assert.ok(sq.x >= 0 && sq.x + sq.s <= g.gridWidth, 'square exceeds grid width');
      assert.ok(sq.y >= 0, 'square has negative row');
    }
  });

  it('never overlaps two squares on the grid', () => {
    const sizes = Array.from({ length: 150 }, (_, i) => 50 + (i % 9) * 400);
    const g = packBlockGrid(sizes, 32);
    const cells = new Set<string>();
    for (const sq of g.squares) {
      for (let y = sq.y; y < sq.y + sq.s; y++) {
        for (let x = sq.x; x < sq.x + sq.s; x++) {
          const key = `${x},${y}`;
          assert.ok(!cells.has(key), `cell ${key} reused`);
          cells.add(key);
        }
      }
    }
  });

  it('packs densely: a full grid of unit squares uses no extra rows', () => {
    // 16*16 unit squares of equal size on a 16-wide grid should fill 16 rows exactly.
    const g = packBlockGrid(Array.from({ length: 256 }, () => 100), 16);
    assert.equal(g.rows, 16);
  });
});
