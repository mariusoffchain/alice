// Bowtie layout for the transaction flow diagram: inputs on the left and
// outputs on the right, drawn as stroked ribbons whose thickness is
// proportional to value, converging into a compressed knot at the centre.
// Pure math, no React, no DOM: this computes SVG path strings and thicknesses
// in a fixed viewBox, the component draws them.
//
// Adapted from mempool/mempool (https://github.com/mempool/mempool),
// frontend/src/app/components/tx-bowtie-graph/tx-bowtie-graph.component.ts,
// (c) Mempool Space K.K. and contributors, licensed AGPL-3.0 - the same
// license as this project. The port keeps mempool's geometry: ribbons are
// bezier centerlines rendered with stroke-width, inner endpoints are packed
// contiguously inside the knot window so the convergence is exact, and
// horizontal offsets computed from the bezier inflection slope keep adjacent
// ribbons from overlapping. Crowding is handled the mempool way: every strand
// is drawn, but only the first `maxStrands` are spread inside the visible
// height; the rest keep stacking past the bottom edge and get clipped by the
// viewBox, forming the dense bundle that plunges off-screen and says "many
// more entries here". Expanding grows the height so everything fits. On top
// of that, this version sorts each side by descending value.

import type { NormalizedTransaction, ScriptType } from './types.ts';

export type BowtieKind = 'input' | 'output' | 'fee';

export type BowtieLine = {
  kind: BowtieKind;
  /** Index in the original tx vector (vin/vout), or -1 for the fee or an aggregate. */
  originalIndex: number;
  /** Real value when known; undefined for a coinbase input or an aggregate of unknowns. */
  valueSats?: number;
  address?: string;
  scriptType?: ScriptType;
  isCoinbase: boolean;
  /** > 0 when this ribbon stands for several folded-away entries. */
  aggregateCount: number;
  /** Inputs only: the outpoint being spent, for the "open previous tx" connector. */
  prevTxid?: string;
  prevVout?: number;
  /** True for a zero-value output (e.g. OP_RETURN): drawn as a short stub. */
  zeroValue: boolean;
  /** True when the amount is blinded (a Liquid confidential in/output): the
   *  ribbon is real but its value is hidden, so the UI shows "unknown". */
  confidential?: boolean;
  /** Stroke width of the ribbon. */
  thickness: number;
  /** The ribbon centerline (stroked, never filled). */
  path: string;
  /** Invisible arrowhead-shaped hover/click target at the outer end. */
  markerPath?: string;
  /** Chevron at the outer edge linking to the previous/spending transaction.
   *  Present for non-coinbase inputs and real outputs; the component decides
   *  whether to draw it (outputs: only once known spent). */
  connectorPath?: string;
};

export type BowtieLayout = {
  width: number;
  /** Drawing height; render the viewBox as `0 0 width (height + 10)`. */
  height: number;
  /** The central bar hiding the seams where ribbons meet. */
  middle: { path: string; strokeWidth: number };
  /** False when one side is entirely zero-value, so the middle bar is dropped. */
  hasLine: boolean;
  inputs: BowtieLine[];
  outputs: BowtieLine[];
  /** How many strands per side run past the bottom edge (clipped from view). */
  inputOverflow: number;
  outputOverflow: number;
  totalInputs: number;
  totalOutputs: number;
  /** True when either side exceeds the cap, so the toggle stays available even
   *  while expanded (otherwise expanding would hide the way back). */
  truncatable: boolean;
};

export type BowtieOptions = {
  /** How many strands per side are spread inside the visible height; the rest
   *  stack past the bottom edge and are clipped (mempool's maxStrands). */
  maxStrands?: number;
  /** Hard cap on drawn lines per side; everything past it is consolidated
   *  into one aggregate line (mempool's lineLimit). */
  lineLimit?: number;
  /** When true, the height grows so every strand fits on screen. */
  expanded?: boolean;
};

// Geometry, mirroring mempool's defaults for width=1200 with connectors on.
const WIDTH = 1200;
const BASE_HEIGHT = 360;
const MAX_COMBINED_WEIGHT = 100;
const MIN_WEIGHT = 2;
const TX_WIDTH = Math.max(WIDTH - 200, WIDTH * 0.8); // 1000: graph without connector margins
const CONNECTOR_WIDTH = (WIDTH - TX_WIDTH) / 2; // 100 per side
const MID_WIDTH = Math.min(10, Math.ceil(WIDTH / 100));
const COMBINED_WEIGHT = Math.min(MAX_COMBINED_WEIGHT, Math.floor((TX_WIDTH - 2 * MID_WIDTH) / 6));
const ZERO_VALUE_THICKNESS = 20;
const ZERO_VALUE_WIDTH = Math.max(20, Math.min(TX_WIDTH / 2 - MID_WIDTH - 110, 60));
/** Vertical budget per visible strand, sizing the drawing height. */
const ROW_SPAN = 24;

type Raw = {
  kind: BowtieKind;
  originalIndex: number;
  /** Conceptual value used for weights; undefined = unknown, gets a share of the remainder. */
  value?: number;
  /** The real value if known, for display. */
  displayValue?: number;
  address?: string;
  scriptType?: ScriptType;
  isCoinbase: boolean;
  aggregateCount: number;
  prevTxid?: string;
  prevVout?: number;
  /** Blinded amount (Liquid confidential in/output). */
  confidential?: boolean;
};

function sortDesc(items: Raw[]): Raw[] {
  // Unknown values (coinbase) sort first: they stand for the whole remainder.
  const v = (r: Raw) => r.value ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => v(b) - v(a));
}

// Hard cap: consolidate everything past the line limit into one aggregate line
// summing the remainder, exactly like mempool's lineLimit handling. This is a
// rendering guard for pathological transactions, not the crowding mechanism -
// crowding is expressed by clipping strands past `maxStrands` off-screen.
function consolidate(items: Raw[], limit: number): Raw[] {
  if (items.length <= limit) return items;
  const keep = items.slice(0, limit);
  const rest = items.slice(limit);
  const restValue = rest.reduce((s, r) => s + (r.value ?? 0), 0);
  const restKnown = rest.every(r => typeof r.displayValue === 'number');
  keep.push({
    kind: rest[0].kind === 'input' ? 'input' : 'output',
    originalIndex: -1,
    value: restValue,
    displayValue: restKnown ? rest.reduce((s, r) => s + (r.displayValue ?? 0), 0) : undefined,
    isCoinbase: false,
    aggregateCount: rest.length,
  });
  return keep;
}

function makePath(side: 'in' | 'out', outer: number, inner: number, thickness: number, offset: number, pad: number): string {
  const start = thickness * 0.5 + CONNECTOR_WIDTH;
  const curveStart = Math.max(start + 5, pad + CONNECTOR_WIDTH - offset);
  const end = WIDTH / 2 - MID_WIDTH * 0.9 + 1;
  const curveEnd = end - offset - 10;
  const midpoint = (curveStart + curveEnd) / 2;

  // correct for the svg horizontal-gradient bug on perfectly flat lines
  if (Math.round(outer) === Math.round(inner)) {
    outer -= 1;
  }

  if (side === 'in') {
    return `M ${start} ${outer} L ${curveStart} ${outer} C ${midpoint} ${outer}, ${midpoint} ${inner}, ${curveEnd} ${inner} L ${end} ${inner}`;
  } else { // mirrored in the y-axis for the right-hand side
    return `M ${WIDTH - start} ${outer} L ${WIDTH - curveStart} ${outer} C ${WIDTH - midpoint} ${outer}, ${WIDTH - midpoint} ${inner}, ${WIDTH - curveEnd} ${inner} L ${WIDTH - end} ${inner}`;
  }
}

function makeZeroValuePath(side: 'in' | 'out', y: number): string {
  const offset = ZERO_VALUE_THICKNESS / 2;
  const start = CONNECTOR_WIDTH / 2 + 10;
  if (side === 'in') {
    return `M ${start + offset} ${y} L ${start + ZERO_VALUE_WIDTH + offset} ${y}`;
  } else {
    return `M ${WIDTH - start - offset} ${y} L ${WIDTH - start - ZERO_VALUE_WIDTH - offset} ${y}`;
  }
}

function makeConnectorPath(side: 'in' | 'out', y: number, inner: number, thickness: number): string {
  const halfWidth = thickness * 0.5;
  const offset = 10;
  const lineEnd = CONNECTOR_WIDTH;

  // align with the gradient-bug correction applied in makePath
  if (Math.round(y) === Math.round(inner)) {
    y -= 1;
  }

  if (side === 'in') {
    return `M ${lineEnd - offset} ${y - halfWidth} L ${halfWidth + lineEnd - offset} ${y} L ${lineEnd - offset} ${y + halfWidth} L -10 ${y + halfWidth} L -10 ${y - halfWidth}`;
  } else {
    return `M ${WIDTH - halfWidth - lineEnd + offset} ${y - halfWidth} L ${WIDTH - lineEnd + offset} ${y} L ${WIDTH - halfWidth - lineEnd + offset} ${y + halfWidth} L ${WIDTH + 10} ${y + halfWidth} L ${WIDTH + 10} ${y - halfWidth}`;
  }
}

function makeMarkerPath(side: 'in' | 'out', y: number, inner: number, thickness: number): string {
  const halfWidth = thickness * 0.5;
  const offset = 10;
  const lineEnd = CONNECTOR_WIDTH;

  if (Math.round(y) === Math.round(inner)) {
    y -= 1;
  }

  if (side === 'in') {
    return `M ${lineEnd - offset} ${y - halfWidth} L ${halfWidth + lineEnd - offset} ${y} L ${lineEnd - offset} ${y + halfWidth} L ${thickness + lineEnd} ${y + halfWidth} L ${thickness + lineEnd} ${y - halfWidth}`;
  } else {
    return `M ${WIDTH - halfWidth - lineEnd + offset} ${y - halfWidth} L ${WIDTH - lineEnd + offset} ${y} L ${WIDTH - halfWidth - lineEnd + offset} ${y + halfWidth} L ${WIDTH - halfWidth - lineEnd} ${y + halfWidth} L ${WIDTH - halfWidth - lineEnd} ${y - halfWidth}`;
  }
}

// Port of mempool's initLines + linesFromWeights: conceptual weights are
// value-proportional shares of the knot weight; drawn thickness is clamped so
// dust stays visible; inner endpoints pack contiguously inside the knot. Only
// the first `visibleStrands` outer endpoints are spread inside the height;
// later strands keep stacking past the bottom and get clipped by the viewBox.
function buildLines(side: 'in' | 'out', xputs: Raw[], total: number, height: number, visibleStrands: number): BowtieLine[] {
  if (xputs.length === 0) return [];

  let weights: number[];
  if (!total) {
    weights = xputs.map(() => COMBINED_WEIGHT / xputs.length);
  } else {
    let unknownCount = 0;
    let unknownTotal = total;
    for (const put of xputs) {
      if (put.value == null) unknownCount++;
      else unknownTotal -= put.value;
    }
    const unknownShare = unknownTotal / unknownCount;
    weights = xputs.map(put => (COMBINED_WEIGHT * (put.value == null ? unknownShare : put.value)) / total);
  }

  const lineParams = weights.map((w, i) => ({
    weight: w,
    thickness: xputs[i].value === 0
      ? ZERO_VALUE_THICKNESS
      : Math.min(COMBINED_WEIGHT + 0.5, Math.max(MIN_WEIGHT - 1, w) + 1),
    offset: 0,
    innerY: 0,
    outerY: 0,
  }));

  const visible = Math.min(visibleStrands, lineParams.length);
  const visibleWeight = lineParams.slice(0, visible).reduce((acc, v) => v.thickness + acc, 0);
  const gaps = visible - 1;

  // bounds of the middle segment
  const innerTop = height / 2 - COMBINED_WEIGHT / 2;
  const innerBottom = innerTop + COMBINED_WEIGHT + 0.5;
  // tracks the visual bottom of the endpoints of the previous line
  let lastOuter = 0;
  let lastInner = innerTop;
  // gap between strands
  const spacing = gaps > 0 ? Math.max(4, (height - visibleWeight) / gaps) : 0;

  // curve adjustments to prevent overlaps
  let offset = 0;
  let minOffset = 0;
  let maxOffset = 0;
  let lastWeight = 0;
  let pad = 0;
  lineParams.forEach((line, i) => {
    if (xputs[i].value === 0) {
      line.outerY = lastOuter + ZERO_VALUE_THICKNESS / 2;
      if (xputs.length === 1) {
        line.outerY = height / 2;
      }
      lastOuter += ZERO_VALUE_THICKNESS + spacing;
      return;
    }

    // vertical position of the (center of the) outer side of the line
    line.outerY = lastOuter + line.thickness / 2;
    line.innerY = Math.min(
      innerBottom - line.thickness / 2,
      Math.max(innerTop + line.thickness / 2, lastInner + line.weight / 2),
    );

    // special case to center single input/outputs
    if (xputs.length === 1) {
      line.outerY = height / 2;
    }

    lastOuter += line.thickness + spacing;
    lastInner += line.weight;

    // conservative lower bound of the horizontal offset required to prevent
    // this line overlapping its neighbour at the bezier inflection point
    const w = (TX_WIDTH - Math.max(lastWeight, line.weight) - CONNECTOR_WIDTH * 2) / 2;
    const y1 = line.outerY;
    const y2 = line.innerY;
    const t = (lastWeight + line.weight) / 2;

    // slope of the inflection point of the bezier curve
    const dx = 0.75 * w;
    const dy = 1.5 * (y2 - y1);
    const a = Math.atan2(dy, dx);

    // parallel curves should be separated by >= t at the inflection point:
    // vertical offset contributes t*cos(a), horizontal offset h contributes
    // h*sin(a), so h >= t(1 - cos(a)) / sin(a)  (clamped to t for sanity)
    if (Math.sin(a) !== 0) {
      offset += Math.max(Math.min((t * (1 - Math.cos(a))) / Math.sin(a), t), -t);
    }

    line.offset = offset;
    minOffset = Math.min(minOffset, offset);
    maxOffset = Math.max(maxOffset, offset);
    pad = Math.max(pad, line.thickness / 2);
    lastWeight = line.weight;
  });

  // normalize offsets
  lineParams.forEach(line => {
    line.offset -= minOffset;
  });
  maxOffset -= minOffset;

  return lineParams.map((line, i) => {
    const put = xputs[i];
    const base: BowtieLine = {
      kind: put.kind,
      originalIndex: put.originalIndex,
      valueSats: put.displayValue,
      address: put.address,
      scriptType: put.scriptType,
      isCoinbase: put.isCoinbase,
      aggregateCount: put.aggregateCount,
      prevTxid: put.prevTxid,
      prevVout: put.prevVout,
      zeroValue: put.value === 0,
      confidential: put.confidential,
      thickness: line.thickness,
      path: '',
    };
    if (put.value === 0) {
      base.path = makeZeroValuePath(side, line.outerY);
      return base;
    }
    base.path = makePath(side, line.outerY, line.innerY, line.thickness, line.offset, pad + maxOffset);
    base.markerPath = makeMarkerPath(side, line.outerY, line.innerY, line.thickness);
    const wantsConnector = put.originalIndex >= 0
      && (side === 'in' ? !put.isCoinbase : put.kind === 'output');
    if (wantsConnector) {
      base.connectorPath = makeConnectorPath(side, line.outerY, line.innerY, line.thickness);
    }
    return base;
  });
}

export function computeBowtie(tx: NormalizedTransaction, opts: BowtieOptions = {}): BowtieLayout {
  const maxStrands = opts.maxStrands ?? 24;
  const lineLimit = opts.lineLimit ?? 250;
  const expanded = opts.expanded ?? false;

  const totalOutput = tx.outputs.reduce((s, o) => s + o.valueSats, 0);
  const fee = tx.feeSats !== null && tx.feeSats > 0 ? tx.feeSats : 0;
  // sum of outputs + fee: the authoritative total both sides must account for
  const totalValue = totalOutput + fee;

  const inputsRaw: Raw[] = tx.inputs.map((v, i) => ({
    kind: 'input',
    originalIndex: i,
    // A coinbase input has no prevout value: leave it unknown so it absorbs the
    // whole remainder (mempool does the same), unless the total itself is zero.
    value: v.isCoinbase && !totalValue ? 0 : v.valueSats,
    displayValue: v.valueSats,
    address: v.address,
    scriptType: v.scriptType,
    isCoinbase: v.isCoinbase,
    aggregateCount: 0,
    prevTxid: v.prevTxid,
    prevVout: v.prevVout,
    confidential: v.amountKnown === false,
  }));

  const outputsRaw: Raw[] = tx.outputs.map(o => ({
    kind: 'output',
    originalIndex: o.index,
    // A confidential output has a real, non-zero amount we simply cannot read:
    // leave value unknown (equal remainder share, a normal ribbon) rather than 0
    // (which would draw an OP_RETURN-style stub), and mark it confidential.
    value: o.amountKnown === false ? undefined : o.valueSats,
    displayValue: o.amountKnown === false ? undefined : o.valueSats,
    address: o.address,
    scriptType: o.scriptType,
    isCoinbase: false,
    aggregateCount: 0,
    confidential: o.amountKnown === false,
  }));

  const inSorted = sortDesc(inputsRaw);
  const outSorted = sortDesc(outputsRaw);
  // The fee rides first on the output side, like on mempool.space: it leaves
  // the knot at the top and its gradient fades out (value reaching no address).
  if (fee > 0) {
    outSorted.unshift({
      kind: 'fee', originalIndex: -1, value: fee, displayValue: fee, isCoinbase: false, aggregateCount: 0,
    });
  }

  const inShown = consolidate(inSorted, lineLimit);
  const outShown = consolidate(outSorted, lineLimit);

  // Collapsed: only the first maxStrands per side are spread inside the
  // height, the rest run off the bottom edge and are clipped - the mempool
  // way of showing "many more" without pretending one big ribbon exists.
  const inVisible = expanded ? inShown.length : Math.min(maxStrands, inShown.length);
  const outVisible = expanded ? outShown.length : Math.min(maxStrands, outShown.length);
  const maxVisible = Math.max(inVisible, outVisible);
  const height = Math.max(BASE_HEIGHT, maxVisible * ROW_SPAN);

  // When any amount is blinded (a Liquid confidential tx) the values are not
  // comparable, and the small fee output would otherwise eat the whole output
  // budget and crush the unknown outputs to a hairline. Fall back to equal
  // weighting per side (mempool's value-less rendering), so unknown outputs read
  // the same as the unknown inputs.
  const confidential = tx.outputs.some(o => o.amountKnown === false)
    || tx.inputs.some(i => i.amountKnown === false);
  const weightTotal = confidential ? 0 : totalValue;

  const inputs = buildLines('in', inShown, weightTotal, height, inVisible);
  const outputs = buildLines('out', outShown, weightTotal, height, outVisible);

  const inputOverflow = Math.max(0, inShown.length - inVisible);
  const outputOverflow = Math.max(0, outShown.length - outVisible);

  const middle = {
    path: `M ${WIDTH / 2 - MID_WIDTH} ${height / 2 + 0.25} L ${WIDTH / 2 + MID_WIDTH} ${height / 2 + 0.25}`,
    strokeWidth: COMBINED_WEIGHT + 0.5,
  };

  const hasLine = inputs.some(l => !l.zeroValue) && outputs.some(l => !l.zeroValue);

  return {
    width: WIDTH,
    height,
    middle,
    hasLine,
    inputs,
    outputs,
    inputOverflow,
    outputOverflow,
    totalInputs: tx.inputs.length,
    totalOutputs: tx.outputs.length,
    truncatable: inShown.length > maxStrands || outShown.length > maxStrands,
  };
}
