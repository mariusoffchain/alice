import { useEffect, type RefObject } from 'react';

// On small screens the pinned visual (the phone, the sovereignty card) sits
// over the scrolling steps. An opaque band behind it would hide the page's
// grid texture, which scrolls with the content and cannot be replicated by a
// pinned copy; so the band is transparent and the TEXT does the work instead:
// each step is hard-clipped at an invisible line just under the visual, so it
// slides beneath the line and is cut clean, no dimming, no gradient. Purely
// presentational and scroll-driven, so it lives outside React state: inline
// clip-path, one rAF per scroll tick.
//
// The hero block (data-step="-1") sits above the pinned visual in the flow
// and never slides under it, so it is exempt.
export function useStepClip(
  zone: RefObject<HTMLElement | null>,
  pinned: RefObject<HTMLElement | null>,
  media: string,
): void {
  useEffect(() => {
    const mq = window.matchMedia(media);
    let raf = 0;
    const update = () => {
      raf = 0;
      const steps = zone.current?.querySelectorAll<HTMLElement>('[data-step]');
      if (!steps) return;
      if (!mq.matches || !pinned.current) {
        steps.forEach((step) => { step.style.clipPath = ''; });
        return;
      }
      const cutLine = pinned.current.getBoundingClientRect().bottom + 8;
      steps.forEach((step) => {
        if (step.dataset.step === '-1') return;
        const rect = step.getBoundingClientRect();
        const hidden = cutLine - rect.top;
        step.style.clipPath = hidden > 0
          ? `inset(${Math.min(hidden, rect.height)}px 0 0 0)`
          : '';
      });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    mq.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mq.removeEventListener('change', schedule);
    };
  }, [zone, pinned, media]);
}
