'use client';

import { ASK_ALICE_ICON_SVG } from '@alice-wallet/alice-ui/components/ask-alice-icon-svg';

interface AskAliceIconProps {
  size?: number;
  /** Bubble fill. */
  color?: string;
  /** Rabbit colour, drawn in negative on the bubble. */
  ink?: string;
}

export function AskAliceIcon({
  size = 48,
  color = 'var(--alice-primary)',
  ink = 'var(--alice-on-primary)',
}: AskAliceIconProps) {
  const svg = ASK_ALICE_ICON_SVG
    .replaceAll('{{COLOR}}', color)
    .replaceAll('{{INK}}', ink);

  const sized = svg
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);

  return (
    <div
      style={{ width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
}
