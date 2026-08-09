import AsyncStorage from '@react-native-async-storage/async-storage';

export type FiatCurrency = 'USD' | 'EUR' | 'CHF';

const KEY = 'alice_fiat_currency';

export const ALL_CURRENCIES: FiatCurrency[] = ['USD', 'EUR', 'CHF'];

export const CURRENCY_SYMBOL: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  CHF: 'CHF',
};

export function priceApiUrl(currency: FiatCurrency): string {
  return `https://api.coinbase.com/v2/prices/BTC-${currency}/spot`;
}

export async function getFiatCurrency(): Promise<FiatCurrency> {
  const val = await AsyncStorage.getItem(KEY);
  if (ALL_CURRENCIES.includes(val as FiatCurrency)) return val as FiatCurrency;
  return 'USD';
}

export async function setFiatCurrency(currency: FiatCurrency): Promise<void> {
  await AsyncStorage.setItem(KEY, currency);
}
