export function friendlyBoltzLimitError(
  raw: string,
  context: 'arkade' | 'boltz' | 'esplora' | 'lightning' | 'bitcoin',
): string | null {
  if (context !== 'boltz' && context !== 'bitcoin') return null;

  const minimum = raw.match(/Boltz minimum total:\s*([\d,]+)\s*sats/i);
  if (minimum) {
    return [
      `BOLTZ ON-CHAIN REQUIRES AT LEAST ${minimum[1]} SATS TOTAL.`,
      'TO SEND THIS AMOUNT ON-CHAIN, TRY ARKADE NATIVE EXIT USING THE BUTTON BELOW.',
      'FOR A SMALLER PAYMENT, SEND VIA ARKADE OR LIGHTNING INSTEAD.',
    ].join('\n');
  }

  const maximum = raw.match(/Boltz maximum total:\s*([\d,]+)\s*sats/i);
  if (maximum) {
    return `BOLTZ ON-CHAIN ACCEPTS AT MOST ${maximum[1]} SATS TOTAL.\nUSE A SMALLER AMOUNT, OR SEND VIA ARKADE OR LIGHTNING INSTEAD.`;
  }

  return null;
}
