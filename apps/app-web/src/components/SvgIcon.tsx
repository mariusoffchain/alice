'use client';

interface SvgIconProps {
  svg: string;
  size?: number;
  color?: string;
}

export function SvgIcon({
  svg,
  size = 24,
  color = 'var(--alice-chat-ink)',
}: SvgIconProps) {
  const colored = svg.replaceAll('{{COLOR}}', color);
  const sized = colored
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);

  return (
    <div
      style={{ width: size, height: size, flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
}
