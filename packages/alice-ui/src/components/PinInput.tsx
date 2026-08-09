import { forwardRef, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { spacing, typography, type Colors, type Pixel } from '@alice-wallet/alice-content';
import { useTheme } from '../theme-context';

type Props = {
  value: string;
  onChange: (value: string) => void;
  length: 4 | 6;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: TextInputProps['style'];
  onComplete?: (value: string) => void;
  onInput?: () => void;
};

export const PinInput = forwardRef<TextInput, Props>(function PinInput(
  {
    value,
    onChange,
    length,
    placeholder,
    editable = true,
    autoFocus = false,
    containerStyle,
    inputStyle,
    onComplete,
    onInput,
  },
  ref,
) {
  const { colors, pixel } = useTheme();
  const s = useMemo(() => makeStyles(colors, pixel), [colors, pixel]);
  const [visible, setVisible] = useState(false);

  function handleChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, length);
    onChange(digits);
    onInput?.();
    if (digits.length === length) onComplete?.(digits);
  }

  return (
    <View style={[s.wrapper, containerStyle]}>
      <TextInput
        ref={ref}
        style={[s.input, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any), inputStyle, !editable && s.disabled]}
        value={value}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType="number-pad"
        inputMode="numeric"
        secureTextEntry={!visible}
        maxLength={length}
        autoFocus={autoFocus}
        editable={editable}
        autoComplete="off"
        autoCorrect={false}
        textContentType="oneTimeCode"
        returnKeyType="done"
      />
      <TouchableOpacity
        style={[s.revealBtn, !editable && s.disabled]}
        onPress={() => setVisible(current => !current)}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide PIN' : 'Show PIN'}
      >
        <Text style={s.revealText}>{visible ? 'HIDE' : 'SHOW'}</Text>
      </TouchableOpacity>
    </View>
  );
});

function makeStyles(colors: Colors, pixel: Pixel) {
  return StyleSheet.create({
    wrapper: {
      ...pixel,
      width: '100%',
      maxWidth: 420,
      marginTop: spacing.md,
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: colors.cardBg,
      overflow: 'hidden',
    },
    input: {
      flex: 1,
      minWidth: 0,
      height: 62,
      paddingVertical: 0,
      paddingHorizontal: spacing.lg,
      fontFamily: typography.pixel,
      fontSize: 16,
      color: colors.primaryDark,
      letterSpacing: 0,
      textAlign: 'center',
      textAlignVertical: 'center',
      includeFontPadding: true,
    },
    revealBtn: {
      width: 90,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderLeftWidth: 3,
      borderLeftColor: colors.border,
    },
    revealText: {
      fontFamily: typography.pixel,
      fontSize: 7,
      color: colors.primaryDark,
      letterSpacing: 1,
    },
    disabled: { opacity: 0.4 },
  });
}
