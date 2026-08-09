type SatoraLimit = 'minimum' | 'maximum';

function limitLabel(limit: SatoraLimit): string {
  return limit === 'minimum' ? 'AMOUNT TOO SMALL' : 'AMOUNT TOO HIGH';
}

function formatLimit(limit: SatoraLimit, sats: number): string {
  return `${limitLabel(limit)}. SATORA ${limit.toUpperCase()}: ${sats.toLocaleString('en-US')} SATS.`;
}

function validSats(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function friendlySatoraLimitError(raw: string): string | null {
  const bitcoinMatch = raw.match(
    /\b(min(?:imum)?|max(?:imum)?)\s+amount\s+is\s+₿\s*([0-9][0-9.\s]*)/i,
  );
  if (bitcoinMatch) {
    const btc = Number(bitcoinMatch[2].replace(/\s/g, ''));
    const sats = validSats(Math.round(btc * 100_000_000));
    if (sats) {
      const limit = bitcoinMatch[1].toLowerCase().startsWith('min')
        ? 'minimum'
        : 'maximum';
      return formatLimit(limit, sats);
    }
  }

  const satsMatch = raw.match(
    /\b(min(?:imum)?|max(?:imum)?|at least)\b[^\d]*([\d,]+)\s*sats?\b/i,
  );
  if (satsMatch) {
    const sats = validSats(Number(satsMatch[2].replace(/,/g, '')));
    if (sats) {
      const limit = satsMatch[1].toLowerCase().startsWith('max')
        ? 'maximum'
        : 'minimum';
      return formatLimit(limit, sats);
    }
  }

  return null;
}
