// Circle-packing for an address's unspent outputs, so their number and relative
// sizes read at a glance: each circle is one UTXO, its area proportional to the
// output's value. Big coins land near the centre, dust rings the edge.
//
// The sibling-packing front-chain algorithm is ported from d3-hierarchy
// (https://github.com/d3/d3-hierarchy), src/pack/siblings.js, (c) Mike Bostock,
// ISC licensed. The final centring uses a bounding box instead of Welzl's
// enclosing circle, which is all we need to frame the layout.

export type PackInput = { valueSats: number; blockTime?: number };
export type PackedCircle = { x: number; y: number; r: number; valueSats: number };
export type PackLayout = { circles: PackedCircle[]; width: number; height: number; maxR: number; shown: number };

type Circle = { x: number; y: number; r: number; valueSats: number };
type PNode = { c: Circle; next: PNode | null; prev: PNode | null };

// Position circle c so it is tangent to a and b (the two anchors on the front).
// Parameter order matches d3's `place(b, a, c)`: the first anchor is b.
function place(b: Circle, a: Circle, c: Circle): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2) {
    const a2 = (a.r + c.r) * (a.r + c.r);
    const b2 = (b.r + c.r) * (b.r + c.r);
    if (a2 > b2) {
      const x = (d2 + b2 - a2) / (2 * d2);
      const y = Math.sqrt(Math.max(0, b2 / d2 - x * x));
      c.x = b.x - x * dx - y * dy;
      c.y = b.y - x * dy + y * dx;
    } else {
      const x = (d2 + a2 - b2) / (2 * d2);
      const y = Math.sqrt(Math.max(0, a2 / d2 - x * x));
      c.x = a.x + x * dx - y * dy;
      c.y = a.y + x * dy + y * dx;
    }
  } else {
    c.x = a.x + c.r;
    c.y = a.y;
  }
}

function intersects(a: Circle, b: Circle): boolean {
  const dr = a.r + b.r - 1e-6;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dr > 0 && dr * dr > dx * dx + dy * dy;
}

// Distance-from-origin of the tangency point of a node and its successor; the
// front-chain pair with the smallest score is the next anchor pair.
function score(node: PNode): number {
  const a = node.c;
  const b = node.next!.c;
  const ab = a.r + b.r;
  const dx = (a.x * b.r + b.x * a.r) / ab;
  const dy = (a.y * b.r + b.y * a.r) / ab;
  return dx * dx + dy * dy;
}

// Pack circles (in place) so none overlap, laid out tightly around the origin.
function packSiblings(circles: Circle[]): void {
  const n = circles.length;
  if (n === 0) return;

  const a = circles[0];
  a.x = 0; a.y = 0;
  if (n <= 1) return;

  const b = circles[1];
  a.x = -b.r; b.x = a.r; b.y = 0;
  if (n <= 2) return;

  // d3: place(b, a, c) with b = circles[1], a = circles[0].
  place(circles[1], circles[0], circles[2]);

  let na: PNode = { c: circles[0], next: null, prev: null };
  let nb: PNode = { c: circles[1], next: null, prev: null };
  let nc: PNode = { c: circles[2], next: null, prev: null };
  na.next = nc.prev = nb;
  nb.next = na.prev = nc;
  nc.next = nb.prev = na;

  pack: for (let i = 3; i < n; ++i) {
    place(na.c, nb.c, circles[i]);
    nc = { c: circles[i], next: null, prev: null };

    let j = nb.next!;
    let k = na.prev!;
    let sj = nb.c.r;
    let sk = na.c.r;
    do {
      if (sj <= sk) {
        if (intersects(j.c, nc.c)) {
          nb = j; na.next = nb; nb.prev = na; --i;
          continue pack;
        }
        sj += j.c.r; j = j.next!;
      } else {
        if (intersects(k.c, nc.c)) {
          na = k; na.next = nb; nb.prev = na; --i;
          continue pack;
        }
        sk += k.c.r; k = k.prev!;
      }
    } while (j !== k.next);

    nc.prev = na; nc.next = nb; na.next = nb.prev = nb = nc;

    let best = score(na);
    let cur = nc;
    while ((cur = cur.next!) !== nb) {
      const s = score(cur);
      if (s < best) { na = cur; best = s; }
    }
    nb = na.next!;
  }
}

/**
 * Lay out unspent outputs as packed circles. Radius is proportional to the
 * square root of value (so area tracks value), with a floor so dust is still a
 * visible dot, and the biggest outputs capped so one whale coin cannot dwarf
 * the rest off-screen. Returns positive coordinates ready for an SVG viewBox.
 */
export function packUtxos(
  utxos: PackInput[],
  opts?: { unit?: number; minRatio?: number; max?: number },
): PackLayout {
  const unit = opts?.unit ?? 40;       // px radius of the largest output
  const minRatio = opts?.minRatio ?? 0.14;
  const max = opts?.max ?? 400;

  const used = utxos.length > max
    ? [...utxos].sort((x, y) => y.valueSats - x.valueSats).slice(0, max)
    : utxos;
  if (used.length === 0) return { circles: [], width: 0, height: 0, maxR: 0, shown: 0 };

  const rawMax = Math.sqrt(Math.max(...used.map(u => u.valueSats), 1));
  const circles: Circle[] = used
    .map(u => {
      const ratio = Math.max(Math.sqrt(Math.max(u.valueSats, 0)) / rawMax, minRatio);
      return { x: 0, y: 0, r: ratio * unit, valueSats: u.valueSats };
    })
    .sort((x, y) => y.r - x.r);

  packSiblings(circles);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of circles) {
    if (c.x - c.r < minX) minX = c.x - c.r;
    if (c.x + c.r > maxX) maxX = c.x + c.r;
    if (c.y - c.r < minY) minY = c.y - c.r;
    if (c.y + c.r > maxY) maxY = c.y + c.r;
  }
  const pad = unit * 0.2;
  for (const c of circles) { c.x = c.x - minX + pad; c.y = c.y - minY + pad; }

  return {
    circles,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    maxR: circles.reduce((m, c) => Math.max(m, c.r), 0),
    shown: circles.length,
  };
}
