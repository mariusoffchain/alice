'use client';

import { playRabbit } from '@/lib/rabbit-player';
import { useEffect, useState } from 'react';
import { rabbitPaths, type RabbitState } from '@/lib/rabbit-motion';

export function AliceRabbit({ state = 'idle', connected = true, size = 40, className }: {
  state?: RabbitState; connected?: boolean; size?: number; className?: string;
}) {
  const [frame, setFrame] = useState<keyof typeof rabbitPaths>('repos');
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let cancel = () => {};
    const play = () => {
      cancel();
      if (!connected || reduced.matches || document.hidden) { setFrame('repos'); return; }
      cancel = playRabbit(state, setFrame);
    };
    play();
    reduced.addEventListener('change', play);
    document.addEventListener('visibilitychange', play);
    return () => {
      cancel();
      reduced.removeEventListener('change', play);
      document.removeEventListener('visibilitychange', play);
    };
  }, [state, connected]);
  return <svg className={className} data-alice-rabbit data-frame={connected ? frame : 'repos'} data-state={connected ? state : 'idle'} role="img" aria-label="Alice" width={size} height={size} viewBox="0 0 40 40" fill="currentColor" style={{ color: 'var(--alice-primary)', shapeRendering: 'crispEdges', flexShrink: 0 }}><path d={rabbitPaths[connected ? frame : 'repos']} /></svg>;
}
