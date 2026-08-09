const SATS_PER_BITCOIN = 100_000_000;

export type UnifiedBip21 = {
  bitcoinAddress: string;
  arkAddress: string;
  amountSats: number | null;
  lightning: string;
};

function bitcoinAmountFromSats(sats: number): string {
  return (sats / SATS_PER_BITCOIN)
    .toFixed(8)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

/** BIP21 request understood by Arkade Wallet: bitcoin:<tb1>?ark=<tark1>&amount=<btc>. */
export function encodeUnifiedBip21({
  bitcoinAddress,
  arkAddress,
  amountSats,
  lightning = '',
}: Omit<UnifiedBip21, 'lightning'> & { lightning?: string }): string {
  const params = new URLSearchParams();
  if (arkAddress) params.set('ark', arkAddress);
  if (lightning) params.set('lightning', lightning);
  if (amountSats && amountSats > 0) params.set('amount', bitcoinAmountFromSats(amountSats));

  const query = params.toString();
  return `bitcoin:${bitcoinAddress}${query ? `?${query}` : ''}`;
}

export function decodeUnifiedBip21(value: string): UnifiedBip21 | null {
  const payload = value.trim();
  if (!payload.toLowerCase().startsWith('bitcoin:')) return null;

  const [bitcoinAddress = '', query = ''] = payload.slice(8).split('?');
  const params = new URLSearchParams(query);
  const getParam = (name: string): string | null => {
    for (const [key, paramValue] of params) {
      if (key.toLowerCase() === name) return paramValue;
    }
    return null;
  };

  const amount = getParam('amount');
  const amountBtc = amount === null ? null : Number(amount);
  const amountSats = amountBtc !== null && Number.isFinite(amountBtc) && amountBtc > 0
    ? Math.round(amountBtc * SATS_PER_BITCOIN)
    : null;

  return {
    bitcoinAddress: bitcoinAddress.trim(),
    arkAddress: getParam('ark')?.trim() ?? '',
    amountSats,
    lightning: getParam('lightning')?.trim() ?? '',
  };
}
