import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { BitcoinIcon } from './BitcoinIcon';
import { formatBalance, formatWalletAmount, type BalanceFormat } from '../balance-format';

type Props = {
  sats: number;
  format: BalanceFormat;
  btcPrice: number | null;
  currencySymbol: string;
  direction?: 'incoming' | 'outgoing';
  textStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  iconSize?: number;
  iconColor?: string;
  /** @deprecated tight is now the default, only pass false to restore the old loose viewBox */
  iconTight?: boolean;
  iconOffsetY?: number;
  gap?: number;
};

export function WalletAmount({
  sats,
  format,
  btcPrice,
  currencySymbol,
  direction,
  textStyle,
  containerStyle,
  iconSize = 14,
  iconColor = '#000000',
  iconTight = true,
  iconOffsetY = 0,
  gap = 4,
}: Props) {
  const sign = direction ? (direction === 'incoming' ? '+' : '-') : '';

  if (format === 'symbol') {
    return (
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap, overflow: 'visible' }, containerStyle]}>
        <View style={{ overflow: 'visible', transform: [{ translateY: iconOffsetY }] }}>
          <BitcoinIcon size={iconSize} color={iconColor} tight={iconTight} />
        </View>
        {sign ? <Text style={textStyle}>{sign}</Text> : null}
        <Text style={textStyle}>{formatBalance(sats, format, btcPrice, currencySymbol)}</Text>
      </View>
    );
  }

  return (
    <Text style={textStyle}>
      {sign}{formatWalletAmount(sats, format, btcPrice, currencySymbol)}
    </Text>
  );
}
