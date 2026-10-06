import { ALICE_SYMBOL_PATH, ALICE_WORDMARK_PATH } from '@/lib/brand';

export function AliceLogo({ size = 20, showWordmark = false }: {
  size?: number;
  showWordmark?: boolean;
}) {
  return (
    <svg
      role="img"
      aria-label="Alice"
      data-alice-brand="d2"
      width={showWordmark ? size * 248 / 48 : size}
      height={size}
      viewBox={showWordmark ? '0 0 248 48' : '0 0 48 48'}
      fill="currentColor"
      shapeRendering="crispEdges"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d={showWordmark ? ALICE_WORDMARK_PATH : ALICE_SYMBOL_PATH} />
    </svg>
  );
}
