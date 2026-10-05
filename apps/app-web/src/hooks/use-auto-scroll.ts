import { useEffect, useRef } from 'react';

export function useAutoScroll(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => { following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 85; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
    // The caller supplies the message and generation dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
