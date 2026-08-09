import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '../theme-context';

type Props = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function PixelToggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  style,
}: Props) {
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);

  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.72}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      style={[s.track, value && s.trackOn, disabled && s.disabled, style]}
    >
      <Text style={[s.state, value ? s.stateOn : s.stateOff]}>{value ? 'ON' : 'OFF'}</Text>
      <Text style={[s.thumb, value ? s.thumbOn : s.thumbOff]}>{value ? 'I' : 'O'}</Text>
    </TouchableOpacity>
  );
}

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    track: {
      ...pixel,
      width: 68,
      height: 32,
      backgroundColor: colors.cardBg,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    trackOn: { backgroundColor: colors.backgroundSoft },
    state: {
      position: 'absolute',
      fontFamily: typography.pixel,
      fontSize: 6,
      letterSpacing: 0,
    },
    stateOn: { left: 7, color: colors.primaryDark },
    stateOff: { right: 5, color: colors.muted },
    thumb: {
      position: 'absolute',
      top: 3,
      width: 22,
      height: 22,
      paddingTop: 7,
      textAlign: 'center',
      fontFamily: typography.pixel,
      fontSize: 8,
      lineHeight: 9,
      letterSpacing: 0,
    },
    thumbOn: { right: 3, backgroundColor: colors.primary, color: colors.onPrimary },
    thumbOff: { left: 3, backgroundColor: colors.dotted, color: colors.muted },
    disabled: { opacity: 0.42 },
  });
}
