import { SatoraRefusalError } from './satora-error-message.ts';

export function friendlyRefundError(error: unknown, provider = 'Satora'): string {
  // The rail already turned Satora's answer into a sentence of ours.
  if (error instanceof SatoraRefusalError) return error.message;
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error');
  const normalized = raw.toLowerCase();
  const label = provider.trim().toUpperCase() || 'SWAP PROVIDER';

  if (normalized.includes('not refundable yet') || normalized.includes('not refundable')) {
    return 'REFUND IS NOT AVAILABLE YET. ALICE WILL KEEP CHECKING THE SWAP STATUS.';
  }
  if (
    normalized.includes('did not provide evidence')
    || normalized.includes('broadcast') && normalized.includes('remains refundable')
  ) {
    return `${label} DID NOT CONFIRM A BROADCAST REFUND. YOUR FUNDS STILL SHOW AS REFUND AVAILABLE. TRY AGAIN LATER.`;
  }
  if (normalized.includes('refund was broadcast') || normalized.includes('do not retry')) {
    return 'THE REFUND WAS BROADCAST, BUT ITS STATUS COULD NOT BE REFRESHED. DO NOT RETRY. ALICE WILL KEEP CHECKING IT.';
  }
  if (
    normalized.includes('failed to fetch')
    || normalized.includes('network')
    || normalized.includes('timeout')
    || normalized.includes('unreachable')
    || normalized.includes('502')
    || normalized.includes('503')
  ) {
    return `${label} COULD NOT BROADCAST THE REFUND. YOUR FUNDS REMAIN RECOVERABLE. CHECK YOUR CONNECTION AND TRY AGAIN.`;
  }

  // Anything else came from a server or a library: not for the screen.
  return `${label} COULD NOT PROCESS THE REFUND. YOUR FUNDS REMAIN RECOVERABLE. TRY AGAIN LATER.`;
}
