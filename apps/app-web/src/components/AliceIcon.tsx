'use client';

import { rabbitPaths } from '@/lib/rabbit-motion';

/** Static version of the shared mascot, used outside the active conversation. */
export function AliceIcon({ size = 48, color = 'var(--alice-primary)' }: { size?: number; color?: string }) {
  return <svg role="img" aria-label="Alice" width={size} height={size} viewBox="0 0 40 40" fill="currentColor" style={{ color, shapeRendering: 'crispEdges', flexShrink: 0 }}><path d={rabbitPaths.repos} /></svg>;
}
