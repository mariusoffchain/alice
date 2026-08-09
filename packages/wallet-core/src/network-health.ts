export function healthCheckFailureDetail(cause: unknown): string {
  const error = cause instanceof Error ? cause : null;
  const message = error?.message ?? String(cause || '');
  const normalized = message.toLowerCase();
  if (
    error?.name === 'AbortError'
    || normalized.includes('aborted')
    || normalized.includes('aborterror')
  ) {
    return 'TIMED OUT';
  }
  if (
    normalized.includes('failed to fetch')
    || normalized.includes('network')
    || normalized.includes('load failed')
  ) {
    return 'NETWORK ERROR';
  }
  return message || 'NETWORK ERROR';
}
