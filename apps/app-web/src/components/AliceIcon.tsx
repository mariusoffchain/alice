'use client';

import { ALICE_ICON_SVG } from '@alice-wallet/alice-ui/components/alice-icon-svg';

interface AliceIconProps {
  size?: number;
  color?: string;
}

export function AliceIcon({
  size = 48,
  color = 'var(--alice-primary)',
}: AliceIconProps) {
  const svg = ALICE_ICON_SVG.replaceAll('{{COLOR}}', color);

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
