// The path from a message to the memory kept on the device, as one inline
// SVG. It reads from the same tokens as the rest of the site, so it follows
// the theme without a second asset. Text is laid out in explicit lines
// because SVG does not wrap; the viewBox is narrow on purpose so the
// diagram scales up on a desktop and stays legible at phone width.

export type MemoryFlowCopy = {
  title: string;
  description: string;
  message: string;
  patterns: BoxCopy;
  model: BoxCopy;
  filters: BoxCopy;
  refused: BoxCopy;
  stored: BoxCopy;
  next: BoxCopy;
  screen: BoxCopy;
};

type BoxCopy = { title: string; lines: string[] };

type Tone = 'default' | 'accent' | 'muted';

const TITLE_SIZE = 11;
const LINE_SIZE = 10.5;
const PAD_X = 10;
const PAD_TOP = 18;
const LINE_STEP = 13;

function boxHeight(lines: number): number {
  return PAD_TOP + 14 + lines * LINE_STEP;
}

function Box({ x, y, w, h, copy, tone = 'default' }: { x: number; y: number; w: number; h: number; copy: BoxCopy; tone?: Tone }) {
  const stroke = tone === 'accent' ? 'var(--alice-primary)' : 'var(--alice-border)';
  const textColor = tone === 'muted' ? 'var(--alice-muted)' : 'var(--alice-text)';
  const titleColor = tone === 'muted' ? 'var(--alice-muted)' : 'var(--alice-heading)';
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        fill="var(--alice-bg-soft)"
        stroke={stroke}
        strokeWidth={tone === 'accent' ? 1.5 : 1}
        strokeDasharray={tone === 'muted' ? '4 3' : undefined}
      />
      <text x={x + PAD_X} y={y + PAD_TOP} fontSize={TITLE_SIZE} fontWeight={600} fill={titleColor}>
        {copy.title}
      </text>
      {copy.lines.map((line, index) => (
        <text key={line} x={x + PAD_X} y={y + PAD_TOP + 14 + index * LINE_STEP} fontSize={LINE_SIZE} fill={textColor}>
          {line}
        </text>
      ))}
    </g>
  );
}

export function MemoryFlowDiagram({ copy, id }: { copy: MemoryFlowCopy; id: string }) {
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const markerId = `${id}-arrow`;

  // Column geometry. Full-width boxes span 16..344; pairs split at 180.
  const left = 16;
  const full = 328;
  const pairW = 156;
  const rightX = left + pairW + 16;
  const leftCenter = left + pairW / 2;
  const rightCenter = rightX + pairW / 2;
  const mid = 180;

  const messageY = 0;
  const messageH = 34;
  const pairY = messageY + messageH + 30;
  const pairH = Math.max(boxHeight(copy.patterns.lines.length), boxHeight(copy.model.lines.length));
  const filtersY = pairY + pairH + 30;
  const filtersH = boxHeight(copy.filters.lines.length);
  const outcomeY = filtersY + filtersH + 30;
  const refusedW = 128;
  const storedX = left + refusedW + 16;
  const storedW = full - refusedW - 16;
  const refusedCenter = left + refusedW / 2;
  const storedCenter = storedX + storedW / 2;
  const refusedH = boxHeight(copy.refused.lines.length);
  const storedH = boxHeight(copy.stored.lines.length);
  const usesY = outcomeY + storedH + 30;
  const usesH = Math.max(boxHeight(copy.next.lines.length), boxHeight(copy.screen.lines.length));
  const height = usesY + usesH + 2;

  const arrow = { stroke: 'var(--alice-muted)', strokeWidth: 1.25, fill: 'none', markerEnd: `url(#${markerId})` } as const;

  return (
    <svg
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      viewBox={`0 0 360 ${height}`}
      className="mx-auto block h-auto w-full max-w-[420px]"
      fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    >
      <title id={titleId}>{copy.title}</title>
      <desc id={descId}>{copy.description}</desc>
      <defs>
        <marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0.5 L8 4 L0 7.5 z" fill="var(--alice-muted)" />
        </marker>
      </defs>

      {/* The message */}
      <rect x={left} y={messageY} width={full} height={messageH} rx={3} fill="var(--alice-bg-soft)" stroke="var(--alice-border)" />
      <text x={mid} y={messageY + 21} textAnchor="middle" fontSize={TITLE_SIZE + 1} fontWeight={600} fill="var(--alice-heading)">
        {copy.message}
      </text>

      {/* Split into the two capture paths */}
      <path d={`M${mid} ${messageY + messageH} V${messageY + messageH + 14} H${leftCenter} V${pairY - 1}`} {...arrow} />
      <path d={`M${mid} ${messageY + messageH + 14} H${rightCenter} V${pairY - 1}`} {...arrow} />

      <Box x={left} y={pairY} w={pairW} h={pairH} copy={copy.patterns} />
      <Box x={rightX} y={pairY} w={pairW} h={pairH} copy={copy.model} />

      {/* Merge into the filters */}
      <path d={`M${leftCenter} ${pairY + pairH} V${pairY + pairH + 14} H${rightCenter} V${pairY + pairH}`} stroke="var(--alice-muted)" strokeWidth={1.25} fill="none" />
      <path d={`M${mid} ${pairY + pairH + 14} V${filtersY - 1}`} {...arrow} />

      <Box x={left} y={filtersY} w={full} h={filtersH} copy={copy.filters} />

      {/* Refused or accepted */}
      <path d={`M${mid} ${filtersY + filtersH} V${filtersY + filtersH + 14} H${refusedCenter} V${outcomeY - 1}`} {...arrow} strokeDasharray="4 3" />
      <path d={`M${mid} ${filtersY + filtersH + 14} H${storedCenter} V${outcomeY - 1}`} {...arrow} />

      <Box x={left} y={outcomeY} w={refusedW} h={refusedH} copy={copy.refused} tone="muted" />
      <Box x={storedX} y={outcomeY} w={storedW} h={storedH} copy={copy.stored} tone="accent" />

      {/* What the stored memory feeds */}
      <path d={`M${storedCenter} ${outcomeY + storedH} V${outcomeY + storedH + 14} H${leftCenter} V${usesY - 1}`} {...arrow} />
      <path d={`M${storedCenter} ${outcomeY + storedH + 14} H${rightCenter} V${usesY - 1}`} {...arrow} />

      <Box x={left} y={usesY} w={pairW} h={usesH} copy={copy.next} />
      <Box x={rightX} y={usesY} w={pairW} h={usesH} copy={copy.screen} />
    </svg>
  );
}
