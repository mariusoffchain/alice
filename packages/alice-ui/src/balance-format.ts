import AsyncStorage from '@react-native-async-storage/async-storage';

export type BalanceFormat = 'symbol' | 'sats' | 'btc' | 'usd';

const KEY = 'alice_balance_format';
const ALL_FORMATS: BalanceFormat[] = ['symbol', 'sats', 'btc', 'usd'];

export async function getBalanceFormat(): Promise<BalanceFormat> {
  const val = await AsyncStorage.getItem(KEY);
  if (ALL_FORMATS.includes(val as BalanceFormat)) return val as BalanceFormat;
  return 'symbol';
}

export async function setBalanceFormat(format: BalanceFormat): Promise<void> {
  await AsyncStorage.setItem(KEY, format);
}

export function nextFormat(current: BalanceFormat): BalanceFormat {
  const idx = ALL_FORMATS.indexOf(current);
  return ALL_FORMATS[(idx + 1) % ALL_FORMATS.length];
}

function withSymbol(symbol: string, amount: string): string {
  return symbol.length > 1 ? `${symbol} ${amount}` : `${symbol}${amount}`;
}

export function formatBalance(sats: number, format: BalanceFormat, btcPrice: number | null, symbol = '$'): string {
  switch (format) {
    case 'sats':
      return sats.toLocaleString('en-US').replace(/,/g, ' ');
    case 'btc':
      return (sats / 100_000_000).toFixed(8);
    case 'usd':
      if (!btcPrice) return '...';
      return withSymbol(symbol, ((sats / 100_000_000) * btcPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    case 'symbol':
    default:
      return sats.toLocaleString('en-US').replace(/,/g, ' ');
  }
}

export function balanceSuffix(format: BalanceFormat): string | null {
  switch (format) {
    case 'sats': return 'sats';
    case 'btc': return 'BTC';
    default: return null;
  }
}

/** Formats a wallet amount with the same unit selected for the main balance. */
export function formatWalletAmount(
  sats: number,
  format: BalanceFormat,
  btcPrice: number | null,
  symbol = '$',
): string {
  const amount = formatBalance(sats, format, btcPrice, symbol);
  switch (format) {
    case 'symbol': return amount;
    case 'sats': return `${amount} sats`;
    case 'btc': return `${amount} BTC`;
    case 'usd': return amount;
  }
}

export function formatSignedWalletAmount(
  sats: number,
  direction: 'incoming' | 'outgoing',
  format: BalanceFormat,
  btcPrice: number | null,
  symbol = '$',
): string {
  return `${direction === 'incoming' ? '+' : '-'}${formatWalletAmount(sats, format, btcPrice, symbol)}`;
}

export function formatSecondary(sats: number, format: BalanceFormat, btcPrice: number | null, symbol = '$'): string | null {
  if (format === 'usd') {
    return sats.toLocaleString('en-US').replace(/,/g, ' ') + ' sats';
  }
  if (!btcPrice) return null;
  return '≈ ' + withSymbol(symbol, ((sats / 100_000_000) * btcPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
