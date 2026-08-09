import { useEffect, useRef } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, View } from 'react-native';

// Single pixel size on every platform so native matches the deployed PWA
// reference (which uses 18). The grid stays fine-grained; the banded opacity
// below keeps the animation cheap regardless of how many squares this produces.
const DEFAULT_PIXEL_SIZE = 18;

// Pixels share a small number of animated opacity layers ("bands") instead of
// one Animated.View per pixel. ~1000 individually animated views janked on
// native (iOS/Android); grouping their fade into BAND_COUNT layers keeps the
// exact same per-pixel timing/window as the PWA reference while animating only
// a few dozen views. The squares themselves stay individual (static Views).
const BAND_COUNT = 120;

type Cell = { x: number; y: number };
type Band = { cells: Cell[]; start: number; end: number; timing: number };

export function PixelFill({
  progress,
  width,
  height,
  color = '#8bb8ff',
  origin = 'bottom-center',
  pixelSize = DEFAULT_PIXEL_SIZE,
  mode = 'fill',
  waveWidth = 0.32,
  onReady,
}: {
  progress: Animated.Value;
  width: number;
  height: number;
  color?: string;
  origin?: 'bottom-center' | 'bottom-edge';
  pixelSize?: number;
  mode?: 'fill' | 'clear' | 'wave';
  waveWidth?: number;
  // Called once, after the grid has been laid out. Callers MUST start the
  // progress animation from here (not before mounting PixelFill): the grid is
  // ~1000+ native views and mounting it takes long enough that a natively
  // driven animation started earlier runs ahead of first paint, so the fill
  // appears to start mid-screen. Fired from onLayout on native; on web, where
  // react-native-web does not reliably dispatch onLayout, a two-frame
  // requestAnimationFrame fallback below fires it instead.
  onReady?: () => void;
}) {
  const bands = useRef<Band[]>([]);
  const gridKey = useRef<string | null>(null);
  const readyFired = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const fireReady = () => {
    if (readyFired.current || bands.current.length === 0) return;
    readyFired.current = true;
    onReadyRef.current?.();
  };

  // onLayout is the primary ready signal (it fires after the native layout
  // pass), but react-native-web does not reliably dispatch it, which left web
  // callers waiting forever. Two frames after commit the grid is guaranteed
  // painted on every platform, so this fallback fires ready then; readyFired
  // keeps the two paths idempotent. Keyed on width/height so a first render
  // with an empty 0x0 grid retries once real dimensions arrive.
  useEffect(() => {
    if (readyFired.current || bands.current.length === 0) return;
    let secondFrame: number | undefined;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(fireReady);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  const size = Math.max(4, pixelSize);
  const w = width;
  const h = height;
  const wave = mode === 'wave';

  // fill/clear share one grid keyed without mode: for them mode only flips the
  // interpolation direction at render time. wave needs its own grid: it keeps
  // each pixel's raw timing (no 0.97/0 clamp) so the band travels past both
  // screen edges and the top/bottom rows fade through it like every other row
  // instead of popping together at the clamp. The clamped grid stays untouched
  // for fill/clear — the payment success animations depend on it.
  const nextGridKey = `${w}:${h}:${size}:${origin}:${wave ? 'wave' : 'edge'}`;

  if (gridKey.current !== nextGridKey && w > 0 && h > 0) {
    const cols = Math.ceil(w / size);
    const rows = Math.ceil(h / size);
    const cx = w / 2;
    const maxDist = h + cx * 0.35;

    const buckets: { cells: Cell[]; startSum: number; endSum: number; timingSum: number }[] = [];
    for (let i = 0; i < BAND_COUNT; i++) {
      buckets.push({ cells: [], startSum: 0, endSum: 0, timingSum: 0 });
    }

    // Per-pixel timing/window copied verbatim from the deployed PWA reference:
    // each pixel reaches full opacity at its `timing` and starts fading in 0.14
    // earlier, which produces the soft "rising tide" from the bottom. We only
    // group the resulting pixels into bands below; the math is identical.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * size;
        const y = row * size;
        const distance = origin === 'bottom-edge'
          ? h - y
          : (h - y) + Math.abs(x - cx) * 0.35;
        const distanceLimit = origin === 'bottom-edge' ? h : maxDist;
        let timing = distance / distanceLimit + (Math.random() - 0.5) * 0.07;
        if (!wave) timing = Math.min(0.97, Math.max(0, timing));
        const start = Math.max(0, timing - 0.14);
        const end = Math.min(1, timing + 0.02);
        // Wave timings span ~[-0.035, 1.035]; band over that whole range so the
        // extreme rows keep their own timing instead of merging into one band.
        const bandPos = wave ? (timing + 0.05) / 1.1 : start;
        const band = Math.min(BAND_COUNT - 1, Math.max(0, Math.floor(bandPos * BAND_COUNT)));
        buckets[band].cells.push({ x, y });
        buckets[band].startSum += start;
        buckets[band].endSum += end;
        buckets[band].timingSum += timing;
      }
    }

    bands.current = buckets
      .filter(bucket => bucket.cells.length > 0)
      .map(bucket => {
        const start = bucket.startSum / bucket.cells.length;
        const end = Math.max(bucket.endSum / bucket.cells.length, start + 0.0001);
        const timing = bucket.timingSum / bucket.cells.length;
        return { cells: bucket.cells, start, end, timing };
      });
    gridKey.current = nextGridKey;
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(_e: LayoutChangeEvent) => fireReady()}
    >
      {bands.current.map((band, bandIndex) => {
        const halfWave = Math.max(0.02, waveWidth / 2);
        const inputRange = mode === 'wave'
          ? [
              band.timing - halfWave,
              band.timing - halfWave + 0.0001,
              band.timing + halfWave - 0.0001,
              band.timing + halfWave,
            ]
          : mode === 'clear'
            ? [1 - band.end, 1 - band.start]
            : [band.start, band.end];
        const outputRange = mode === 'wave' ? [0, 1, 1, 0] : [0, 1];
        return (
          <Animated.View
            key={bandIndex}
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: progress.interpolate({
                  inputRange,
                  outputRange,
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            {band.cells.map((cell, cellIndex) => (
              <View
                key={cellIndex}
                style={{
                  position: 'absolute',
                  left: cell.x,
                  top: cell.y,
                  width: size,
                  height: size,
                  backgroundColor: color,
                }}
              />
            ))}
          </Animated.View>
        );
      })}
    </View>
  );
}
