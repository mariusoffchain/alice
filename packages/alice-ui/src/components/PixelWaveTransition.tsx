import { ReactNode, useLayoutEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { PixelFill } from './PixelFill';

export type PixelWavePhase = 'closed' | 'opening' | 'open' | 'closing';

// The reveal edge trails the wave centre by (halfWave - REVEAL_INSET): the
// incoming surface only ever appears where the opaque band has already passed.
// PixelFill jitters each pixel's timing by ±0.035, so the inset keeps the edge
// safely inside the band even for the unluckiest pixel.
const REVEAL_INSET = 0.06;
// Extra progress travelled beyond [0, 1] so the band starts and ends fully
// off-screen (jitter included) and the reveal completes before the band exits.
const EDGE_PADDING = 0.08;

// Full-window pixel-wave transition between two stacked surfaces. Mount it
// over the outgoing surface, give it the incoming surface as children, and
// drive it with `phase`; a single internal Animated.Value pilots both the
// PixelFill wave and the reveal of the children, so the two can never drift
// apart. The reveal is a pair of opposite translateY transforms inside an
// overflow-hidden clip (never an animated height), so the whole transition
// runs with useNativeDriver and survives JS jank while the children mount.
//
// The caller must render this OUTSIDE any padded container (SafeAreaView,
// keyboard spacers): the overlay sizes itself to the window and assumes its
// parent's origin is the physical screen origin, which is how it covers the
// status bar and both safe areas.
export function PixelWaveTransition({
  phase,
  color,
  waveWidth = 0.32,
  durationMs = 600,
  pixelSize,
  onOpened,
  onClosed,
  children,
}: {
  phase: PixelWavePhase;
  color: string;
  waveWidth?: number;
  durationMs?: number;
  pixelSize?: number;
  // Fired when the opening/closing pass completes; the caller flips `phase`
  // to 'open'/'closed' from here.
  onOpened?: () => void;
  onClosed?: () => void;
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const halfWave = Math.max(0.02, waveWidth / 2);
  const edge = halfWave + EDGE_PADDING;
  const revealLag = Math.max(0, halfWave - REVEAL_INSET);

  const progress = useRef(new Animated.Value(-edge)).current;
  const lastPhase = useRef<PixelWavePhase>('closed');
  const gridReady = useRef(false);
  const pending = useRef<'opening' | 'closing' | null>(null);

  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const run = (direction: 'opening' | 'closing') => {
    Animated.timing(progress, {
      toValue: direction === 'opening' ? 1 + edge : -edge,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Interrupted runs (a new timing retargeted the value) end unfinished
      // and must not fire the phase-change callbacks.
      if (!finished) return;
      if (direction === 'opening') onOpenedRef.current?.();
      else onClosedRef.current?.();
    });
  };
  const runRef = useRef(run);
  runRef.current = run;

  // useLayoutEffect so the progress snap lands before the new phase's first
  // frame is painted: a plain effect runs after paint and would let one frame
  // show a stale value (a blue flash, or the children half-revealed).
  // Interruptions (opening <-> closing) skip the snap so the wave turns
  // around in place instead of teleporting to the opposite edge.
  useLayoutEffect(() => {
    const prev = lastPhase.current;
    lastPhase.current = phase;

    if (phase === 'opening' || phase === 'closing') {
      const interrupted = (phase === 'opening' && prev === 'closing')
        || (phase === 'closing' && prev === 'opening');
      if (!interrupted) progress.setValue(phase === 'opening' ? -edge : 1 + edge);
      if (width <= 0 || height <= 0) {
        // Nothing to animate over (layout race on web); settle immediately.
        if (phase === 'opening') onOpenedRef.current?.();
        else onClosedRef.current?.();
        return;
      }
      // The animation must start from PixelFill's onReady: the grid is ~1000+
      // views and progress moving before it paints makes the wave start
      // mid-screen. When interrupting an opposite pass the grid is already
      // mounted and ready, so we retarget immediately.
      if (gridReady.current) runRef.current(phase);
      else pending.current = phase;
    } else {
      pending.current = null;
      gridReady.current = false; // the wave unmounts in the resting phases
      progress.stopAnimation();
      progress.setValue(phase === 'open' ? 1 + edge : -edge);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === 'closed') return null;

  const animating = phase === 'opening' || phase === 'closing';

  // Children stay full-size and visually fixed: the outer clip slides down by
  // (1 - reveal) * height while the inner container counter-slides up by the
  // same amount, so the clip's top edge is the only thing that moves.
  const clipTranslate = progress.interpolate({
    inputRange: [revealLag, 1 + revealLag],
    outputRange: [height, 0],
    extrapolate: 'clamp',
  });
  const contentTranslate = progress.interpolate({
    inputRange: [revealLag, 1 + revealLag],
    outputRange: [-height, 0],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[styles.overlay, { width, height }]}
      pointerEvents={phase === 'open' ? 'box-none' : 'none'}
    >
      <Animated.View style={[styles.clip, { transform: [{ translateY: clipTranslate }] }]}>
        <Animated.View style={{ width, height, transform: [{ translateY: contentTranslate }] }}>
          {children}
        </Animated.View>
      </Animated.View>
      {animating && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <PixelFill
            progress={progress}
            width={width}
            height={height}
            color={color}
            origin="bottom-edge"
            mode="wave"
            waveWidth={waveWidth}
            pixelSize={pixelSize}
            onReady={() => {
              gridReady.current = true;
              const queued = pending.current;
              pending.current = null;
              if (queued) runRef.current(queued);
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', zIndex: 30 },
  clip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
});
