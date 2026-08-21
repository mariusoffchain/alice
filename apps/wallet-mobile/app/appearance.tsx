import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import { spacing, typography, PALETTES, ALL_PALETTE_IDS, type PaletteId } from '@alice-wallet/alice-content';
import { useTheme } from '@alice-wallet/alice-ui';

const GRID = 37;
const GAP = 1;
const INNER_RATIO = 0.4;
const COUNT = ALL_PALETTE_IDS.length;

type Region =
  | { type: 'palette'; id: PaletteId }
  | { type: 'toggle'; half: 'light' | 'dark'; dot: boolean }
  | { type: 'empty' };

function regionAt(px: number, py: number, outerR: number, innerR: number): Region {
  const dist = Math.hypot(px, py);
  if (!Number.isFinite(dist) || dist > outerR) return { type: 'empty' };
  if (dist <= innerR) {
    const half: 'light' | 'dark' = px < 0 ? 'light' : 'dark';
    const dc = half === 'light' ? -innerR * 0.45 : innerR * 0.45;
    const dot = Math.hypot(px - dc, py) < innerR * 0.24;
    return { type: 'toggle', half, dot };
  }
  const deg = (Math.atan2(py, px) * 180) / Math.PI;
  const a = (deg + 90 + 360) % 360;
  const idx = Math.floor(a / (360 / COUNT)) % COUNT;
  return { type: 'palette', id: ALL_PALETTE_IDS[idx] };
}

export default function AppearanceScreen() {
  const router = useRouter();
  const { mode, palette, colors, pixel, toggle, setPalette } = useTheme();
  const { width: screenWidth } = useWindowDimensions();

  const size = Math.min(Math.max(screenWidth - 32, 280), 360);
  const cell = size / GRID;
  const R = size / 2;
  const outerR = R - cell * 0.15;
  const innerR = R * INNER_RATIO;

  function regionColor(r: Region): string | null {
    if (r.type === 'empty') return null;
    if (r.type === 'toggle') {
      if (r.half === 'light') return r.dot ? '#0a0a0a' : '#ffffff';
      return r.dot ? '#ffffff' : '#0a0a0a';
    }
    if (r.id === 'mono') return mode === 'dark' ? '#e0e0e0' : '#1a1a1a';
    return PALETTES[r.id].primary;
  }

  function regionOpacity(r: Region): number {
    if (r.type !== 'palette') return 1;
    return r.id === palette ? 1 : 0.4;
  }

  const rects: React.ReactElement[] = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const px = (col + 0.5) * cell - R;
      const py = (row + 0.5) * cell - R;
      const region = regionAt(px, py, outerR, innerR);
      const color = regionColor(region);
      if (!color) continue;
      rects.push(
        <Rect
          key={`${col}-${row}`}
          x={col * cell + GAP / 2}
          y={row * cell + GAP / 2}
          width={cell - GAP}
          height={cell - GAP}
          fill={color}
          opacity={regionOpacity(region)}
        />,
      );
    }
  }

  function handleTap(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
    if (typeof locationX !== 'number' || typeof locationY !== 'number') return;
    if (!Number.isFinite(locationX) || !Number.isFinite(locationY)) return;
    const region = regionAt(locationX - R, locationY - R, outerR, innerR);
    if (region.type === 'toggle') toggle();
    else if (region.type === 'palette') setPalette(region.id);
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/settings')} style={[s.backBtn, pixel, { backgroundColor: colors.cardBg }]}>
          <Text style={[s.backIcon, { color: colors.primary }]}>←</Text>
        </TouchableOpacity>
        <Text style={[s.title, { color: colors.primaryDark }]}>APPEARANCE</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={s.wheelContainer}>
        <View
          style={{ width: size, height: size }}
          onStartShouldSetResponder={() => true}
          onResponderRelease={handleTap}
        >
          <Svg width={size} height={size} pointerEvents="none">
            {rects}
          </Svg>
        </View>
      </View>

      <View style={s.labelRow}>
        <Text style={[s.label, { color: colors.muted }]}>
          {mode === 'dark' ? '● DARK' : '○ LIGHT'}
        </Text>
        <Text style={[s.label, { color: colors.primary }]}>
          {PALETTES[palette].label.toUpperCase()}
        </Text>
      </View>

      <Text style={[s.hint, { color: colors.muted }]}>
        Tap center to toggle theme{'\n'}Tap the ring to change color
      </Text>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontFamily: typography.pixel, fontSize: 18 },
  title: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 3 },
  wheelContainer: { alignItems: 'center', marginTop: spacing.xxxl, marginBottom: spacing.xl },
  labelRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xl, marginBottom: spacing.md },
  label: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 2 },
  hint: { fontFamily: typography.pixel, fontSize: 12, textAlign: 'center', lineHeight: 14, letterSpacing: 1 },
});
