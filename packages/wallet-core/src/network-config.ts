/**
 * Network configuration — single source of truth for all environment-specific URLs.
 * Reads from environment variables, with sensible Mutinynet defaults.
 */

export type AliceNetwork = 'mutinynet' | 'bitcoin';

function resolveNetwork(value: string | undefined): AliceNetwork {
  const network = value?.trim() || 'mutinynet';
  if (network !== 'mutinynet' && network !== 'bitcoin') {
    throw new Error(`Unsupported EXPO_PUBLIC_NETWORK value: ${network}.`);
  }
  return network;
}

export const NETWORK = resolveNetwork(process.env.EXPO_PUBLIC_NETWORK);

function requiredMainnetUrl(
  name: string,
  value: string | undefined,
  mutinynetDefault: string,
): string {
  if (value?.trim()) return value.trim();
  if (NETWORK === 'bitcoin') {
    throw new Error(`${name} must be configured explicitly for Bitcoin mainnet.`);
  }
  return mutinynetDefault;
}

export const ASP_URL =
  requiredMainnetUrl(
    'EXPO_PUBLIC_ASP_URL',
    process.env.EXPO_PUBLIC_ASP_URL,
    'https://mutinynet.arkade.sh',
  );

export const ESPLORA_URL =
  requiredMainnetUrl(
    'EXPO_PUBLIC_ESPLORA_URL',
    process.env.EXPO_PUBLIC_ESPLORA_URL,
    'https://mutinynet.com/api',
  );

export const BOLTZ_URL =
  process.env.EXPO_PUBLIC_BOLTZ_URL ??
  (NETWORK === 'mutinynet' ? 'https://api.boltz.mutinynet.arkade.sh' : '');

export type SwapProvider = 'boltz' | 'satora';

function resolveSwapProvider(value: string | undefined): SwapProvider {
  const provider = value?.trim() || 'boltz';
  if (provider !== 'boltz' && provider !== 'satora') {
    throw new Error(`Unsupported EXPO_PUBLIC_SWAP_PROVIDER value: ${provider}.`);
  }
  return provider;
}

export const SWAP_PROVIDER = resolveSwapProvider(
  process.env.EXPO_PUBLIC_SWAP_PROVIDER,
);

export const SATORA_URL =
  SWAP_PROVIDER === 'satora'
    ? requiredMainnetUrl(
      'EXPO_PUBLIC_SATORA_URL',
      process.env.EXPO_PUBLIC_SATORA_URL,
      'https://mutinynetswap.lendasat.com',
    )
    : '';

export const ARKADE_EXPLORER =
  process.env.EXPO_PUBLIC_ARKADE_EXPLORER ??
  (NETWORK === 'mutinynet' ? 'https://explorer.mutinynet.arkade.sh' : 'https://arkade.space');

export const MEMPOOL_EXPLORER =
  NETWORK === 'bitcoin'
    ? 'https://mempool.space'
    : 'https://mutinynet.com';

export const ARKADE_INFO_URL = `${ASP_URL}/v1/info`;
export const BOLTZ_HEALTH_URL = `${BOLTZ_URL}/v2/swap/submarine`;
export const SATORA_HEALTH_URL = SATORA_URL ? `${SATORA_URL}/health` : null;
export const ESPLORA_TIP_URL = `${ESPLORA_URL}/blocks/tip/height`;

// IndexedDB name — prefix with network to avoid collisions
export const WEB_DB_NAME = `alice-ark-${NETWORK}`;

// Payment network type (used by payment parser)
export type PaymentNetwork = 'mutinynet' | 'bitcoin';
export const PAYMENT_NETWORK: PaymentNetwork =
  NETWORK === 'bitcoin' ? 'bitcoin' : 'mutinynet';
