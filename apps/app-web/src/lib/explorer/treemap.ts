// Block treemap packing, ported from mempool/mempool
// (https://github.com/mempool/mempool), frontend block-overview-graph
// BlockScene / BlockLayout, (c) Mempool Space K.K. and contributors, AGPL-3.0
// (the same license as this project).
//
// The idea that removes the gaps a naive square-pack leaves: every transaction
// is quantised to an INTEGER number of grid units (side proportional to
// sqrt(vsize)), and placement is a bottom-up, left-to-right free-slot fit that
// backfills the holes left under larger squares with smaller ones. Sizes align
// to the grid, so they tessellate; the backfill keeps it dense.
//
// No canvas, no DOM: returns positions in grid units. The component scales them.

export type GridSquare = {
  /** Index into the original vsizes array. */
  index: number;
  x: number;
  y: number;
  s: number;
};

export type BlockGrid = {
  gridWidth: number;
  rows: number;
  squares: GridSquare[];
};

type Interval = { l: number; r: number };

// Intersection of two sorted, disjoint interval lists.
function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const l = Math.max(a[i].l, b[j].l);
    const r = Math.min(a[i].r, b[j].r);
    if (r > l) out.push({ l, r });
    if (a[i].r < b[j].r) i++; else j++;
  }
  return out;
}

export function packBlockGrid(vsizes: number[], resolution = 80, capacityVsize?: number): BlockGrid {
  const R = resolution;
  const n = vsizes.length;
  if (n === 0) return { gridWidth: R, rows: 0, squares: [] };

  // Scale each square by its share of the block's CAPACITY, not of the block's
  // own total, so a near-empty block reads as near-empty (its transactions stay
  // small and the R x R grid is mostly free) instead of being blown up to fill.
  // When no capacity is given, or the block is fuller than it (shouldn't happen),
  // fall back to the total so a full block still fills the grid, as before.
  const total = vsizes.reduce((s, v) => s + Math.max(1, v), 0) || 1;
  const denom = capacityVsize && capacityVsize > total ? capacityVsize : total;
  const sizeOf = (v: number) => Math.min(R, Math.max(1, Math.round(Math.sqrt(Math.max(1, v) / denom) * R)));
  const order = vsizes.map((v, i) => ({ i, s: sizeOf(v) })).sort((a, b) => b.s - a.s);

  const rows: Interval[][] = [];
  const ensure = (y: number) => { while (rows.length <= y) rows.push([{ l: 0, r: R }]); };

  // Leftmost x where an s-wide slot is free across rows y..y+s-1, else null.
  const fitAtY = (y: number, s: number): number | null => {
    ensure(y + s - 1);
    let inter = rows[y];
    for (let yy = y + 1; yy < y + s; yy++) inter = intersect(inter, rows[yy]);
    for (const iv of inter) if (iv.r - iv.l >= s) return iv.l;
    return null;
  };

  const occupy = (y: number, x: number, s: number) => {
    for (let yy = y; yy < y + s; yy++) {
      ensure(yy);
      const next: Interval[] = [];
      for (const iv of rows[yy]) {
        if (iv.r <= x || iv.l >= x + s) { next.push(iv); continue; }
        if (iv.l < x) next.push({ l: iv.l, r: x });
        if (iv.r > x + s) next.push({ l: x + s, r: iv.r });
      }
      rows[yy] = next;
    }
  };

  const squares: GridSquare[] = [];
  let maxRows = 0;
  for (const { i, s } of order) {
    let y = 0;
    let x: number | null = null;
    const limit = rows.length + n + R;
    while (y < limit) {
      x = fitAtY(y, s);
      if (x !== null) break;
      y++;
    }
    if (x === null) { x = 0; y = rows.length; }
    occupy(y, x, s);
    squares.push({ index: i, x, y, s });
    if (y + s > maxRows) maxRows = y + s;
  }

  return { gridWidth: R, rows: maxRows, squares };
}
