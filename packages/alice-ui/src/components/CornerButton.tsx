import { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { typography } from '@alice-wallet/alice-content';
import { CORNER_SVG } from './corner-svg';

type Props = {
  label: string;
  color?: string;
  width?: number;
  height?: number;
};

const CORNER_SIZE = 20;

export const CornerButton = memo(function CornerButton({ label, color = '#8cbffc', width = 140, height = 70 }: Props) {
  const xml = useMemo(() => CORNER_SVG.replaceAll('{{COLOR}}', color), [color]);

  return (
    <View style={[s.container, { width, height }]}>
      {/* Original SVG is bottom-left ┗ (arm goes up + arm goes right) */}
      {/* Top-left ┏ = rotate 90° */}
      <View style={[s.corner, s.topLeft, { transform: [{ rotate: '90deg' }] }]}>
        <SvgXml xml={xml} width={CORNER_SIZE} height={CORNER_SIZE} />
      </View>
      {/* Top-right ┓ = rotate 180° */}
      <View style={[s.corner, s.topRight, { transform: [{ rotate: '180deg' }] }]}>
        <SvgXml xml={xml} width={CORNER_SIZE} height={CORNER_SIZE} />
      </View>
      {/* Bottom-left ┗ = original (0°) */}
      <View style={[s.corner, s.bottomLeft]}>
        <SvgXml xml={xml} width={CORNER_SIZE} height={CORNER_SIZE} />
      </View>
      {/* Bottom-right ┛ = rotate 270° */}
      <View style={[s.corner, s.bottomRight, { transform: [{ rotate: '270deg' }] }]}>
        <SvgXml xml={xml} width={CORNER_SIZE} height={CORNER_SIZE} />
      </View>
      {/* Label */}
      <Text style={[s.label, { color }]}>{label}</Text>
    </View>
  );
});

const s = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute' },
  topLeft: { top: 0, left: 0 },
  topRight: { top: 0, right: 0 },
  bottomLeft: { bottom: 0, left: 0 },
  bottomRight: { bottom: 0, right: 0 },
  flipH: { transform: [{ scaleX: -1 }] },
  flipV: { transform: [{ scaleY: -1 }] },
  flipBoth: { transform: [{ scaleX: -1 }, { scaleY: -1 }] },
  label: { fontFamily: typography.pixel, fontSize: 12, letterSpacing: 2 },
});
