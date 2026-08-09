import type { AliceNetwork } from './network-config.ts';

export function explorerUnavailableError(network: AliceNetwork): string {
  return `${network === 'bitcoin' ? 'BITCOIN MAINNET' : 'MUTINYNET'} EXPLORER UNREACHABLE. PAYMENT STATUS MAY BE DELAYED.`;
}
