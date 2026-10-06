'use client';

import { useEffect, useRef, useState } from 'react';
import { TYPING_PAUSE_MS } from '@/lib/rabbit-player';
import type { RabbitState } from '@/lib/rabbit-motion';

// One conversation state policy for the main chat and the page sidebars.
// AliceRabbit owns the frame player, reduced-motion and hidden-page handling.
export function useChatRabbit({ input, busy, available, replyStarted }: {
  input: string;
  busy: boolean;
  available: boolean;
  replyStarted: boolean;
}): RabbitState {
  const [calmState, setCalmState] = useState<RabbitState>('idle');
  const previousBusy = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!busy) {
      const next = previousBusy.current ? 'settling' : input.trim() ? 'typing' : 'idle';
      setCalmState(next);
      if (next === 'typing') timer = setTimeout(() => setCalmState('relaxing'), TYPING_PAUSE_MS);
      else if (next === 'settling') timer = setTimeout(() => setCalmState('idle'), 1240);
    }
    previousBusy.current = busy;
    return () => clearTimeout(timer);
  }, [busy, input]);
  return !available ? 'idle' : busy ? (replyStarted ? 'streaming' : 'waiting') : calmState;
}
