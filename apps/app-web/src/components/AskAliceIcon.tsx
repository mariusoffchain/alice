'use client';

import { AliceIcon } from './AliceIcon';

interface AskAliceIconProps {
  size?: number;
  /** Shared mascot colour, derived from the selected palette. */
  color?: string;
}

export function AskAliceIcon({
  size = 48,
  color = 'var(--alice-primary)',
}: AskAliceIconProps) {
  return <AliceIcon size={size} color={color} />;
}
