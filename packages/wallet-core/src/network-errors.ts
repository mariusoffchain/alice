import {
  ARKADE_INFO_URL,
  BOLTZ_HEALTH_URL,
  ESPLORA_TIP_URL,
  NETWORK,
  SATORA_HEALTH_URL,
  SWAP_PROVIDER,
} from './network-config';
import { explorerUnavailableError } from './network-labels';
import { healthCheckFailureDetail } from './network-health';

export {
  ARKADE_INFO_URL,
  BOLTZ_HEALTH_URL,
  ESPLORA_TIP_URL,
  SATORA_HEALTH_URL,
};

export type ServiceHealth = {
  id: 'arkade' | 'boltz' | 'satora' | 'esplora';
  label: string;
  ok: boolean;
  detail: string;
};

export function friendlyNetworkError(error: unknown, context: 'arkade' | 'boltz' | 'esplora' | 'lightning' | 'bitcoin' = 'arkade'): string {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error');
  const normalized = raw.toLowerCase();
  const usesConfiguredSwapProvider = (
    context === 'lightning'
    || context === 'bitcoin'
  );
  const swapLabel = usesConfiguredSwapProvider && SWAP_PROVIDER === 'satora'
    ? 'SATORA'
    : 'BOLTZ';

  const boltzLimitError = friendlyBoltzLimitError(raw, context);
  if (boltzLimitError) return boltzLimitError;
  if (normalized.includes('invoice') && normalized.includes('expired')) {
    return 'LIGHTNING INVOICE EXPIRED. ASK FOR A NEW INVOICE AND TRY AGAIN.';
  }
  if (
    normalized.includes('dns:lnd')
    || normalized.includes('name resolution failed')
    || normalized.includes('target dns:lnd')
  ) {
    return `${swapLabel} LIGHTNING SERVICE IS TEMPORARILY UNAVAILABLE. NO FUNDS WERE SENT. TRY AGAIN LATER.`;
  }
  if (normalized.includes('boltz api error') && normalized.includes('400') && context === 'lightning') {
    return `${swapLabel} COULD NOT CREATE A LIGHTNING INVOICE RIGHT NOW. NO FUNDS WERE SENT. TRY AGAIN LATER.`;
  }
  if (normalized.includes('satora is not configured')) {
    return 'SATORA IS NOT CONFIGURED FOR THIS NETWORK. CHECK THE MAINNET SATORA URL BEFORE TESTING.';
  }
  if (normalized.includes('failed to fetch') || normalized.includes('network') || normalized.includes('timeout') || normalized.includes('unreachable')) {
    if (context === 'boltz' || context === 'lightning' || context === 'bitcoin') {
      return `${swapLabel} SERVER UNREACHABLE. NO FUNDS WERE SENT. CHECK SERVER STATUS AND TRY AGAIN.`;
    }
    if (context === 'esplora') {
      return explorerUnavailableError(NETWORK);
    }
    return 'ARKADE SERVER UNREACHABLE. CHECK YOUR CONNECTION AND TRY AGAIN.';
  }
  if (normalized.includes('502') || normalized.includes('bad gateway')) {
    return context === 'boltz' || context === 'lightning' || context === 'bitcoin'
      ? `${swapLabel} SERVER IS RETURNING BAD GATEWAY. NO FUNDS WERE SENT. TRY AGAIN LATER.`
      : 'ARKADE SERVER IS RETURNING BAD GATEWAY. TRY AGAIN LATER.';
  }
  if (normalized.includes('503') || normalized.includes('service unavailable')) {
    return context === 'boltz' || context === 'lightning' || context === 'bitcoin'
      ? `${swapLabel} SERVER IS TEMPORARILY UNAVAILABLE. NO FUNDS WERE SENT.`
      : 'ARKADE SERVER IS TEMPORARILY UNAVAILABLE.';
  }
  if (normalized.includes('invoice') && normalized.includes('invalid')) {
    return 'INVALID LIGHTNING INVOICE. ASK FOR A NEW INVOICE AND TRY AGAIN.';
  }

  return raw;
}

async function checkUrlAttempt(
  id: ServiceHealth['id'],
  label: string,
  url: string,
  timeoutMs: number,
): Promise<ServiceHealth> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { id, label, ok: false, detail: `HTTP ${response.status}` };
    }
    return { id, label, ok: true, detail: 'OK' };
  } catch (cause) {
    return { id, label, ok: false, detail: healthCheckFailureDetail(cause) };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkUrl(
  id: ServiceHealth['id'],
  label: string,
  url: string,
): Promise<ServiceHealth> {
  const first = await checkUrlAttempt(id, label, url, 8_000);
  if (first.ok || !['TIMED OUT', 'NETWORK ERROR'].includes(first.detail)) return first;
  return checkUrlAttempt(id, label, url, 4_000);
}

export async function checkNetworkHealth(): Promise<ServiceHealth[]> {
  const swapHealth = SWAP_PROVIDER === 'satora' && SATORA_HEALTH_URL
    ? checkUrl('satora', 'SATORA', SATORA_HEALTH_URL)
    : checkUrl('boltz', 'BOLTZ', BOLTZ_HEALTH_URL);
  return Promise.all([
    checkUrl('arkade', 'ARKADE', ARKADE_INFO_URL),
    swapHealth,
    checkUrl('esplora', 'BITCOIN EXPLORER', ESPLORA_TIP_URL),
  ]);
}
