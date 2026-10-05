import { rabbitCycles, type RabbitState, type rabbitPaths } from './rabbit-motion.ts';

export type RabbitFrame = keyof typeof rabbitPaths;
export interface RabbitClock { schedule(callback: () => void, delay: number): unknown; cancel(timer: unknown): void }
const clock: RabbitClock = { schedule: (cb, ms) => setTimeout(cb, ms), cancel: id => clearTimeout(id as ReturnType<typeof setTimeout>) };
/** Typing holds its final pose; only transport states repeat. Cleanup cancels stale work. */
export function playRabbit(state: RabbitState, onFrame: (frame: RabbitFrame) => void, timing = clock) {
  let timer: unknown;
  let stopped = false;
  let index = 0;
  const step = () => {
    if (stopped) return;
    if (state === 'idle') { onFrame('repos'); return; }
    const cycle = rabbitCycles[state];
    const [pose, duration] = cycle[index];
    onFrame(pose);
    if (state === 'typing' && index === cycle.length - 1) return;
    timer = timing.schedule(() => {
      if (stopped) return;
      index++;
      if (index === cycle.length) {
        if (state === 'waiting' || state === 'streaming') index = 0;
        else { onFrame('repos'); return; }
      }
      step();
    }, duration);
  };
  step();
  return () => { stopped = true; timing.cancel(timer); };
}
export const TYPING_PAUSE_MS = 1800;
