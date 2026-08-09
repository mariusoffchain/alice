// Venice error shapes and classification, kept apart from `llm.ts` because
// that module imports `expo/fetch` and cannot be loaded outside the Expo
// runtime. Everything here is pure, so it can be tested directly.

export type VeniceErrorCode =
  | 'missing_api_key'
  | 'account_required'
  | 'free_quota_exhausted'
  | 'plan_restricted'
  | 'auth'
  | 'insufficient_credits'
  | 'model_unavailable'
  | 'rate_limit'
  | 'provider_unavailable'
  | 'attestation_unavailable'
  | 'attestation_invalid'
  | 'network'
  | 'api_error';

export class VeniceAPIError extends Error {
  readonly code: VeniceErrorCode;
  readonly status?: number;

  constructor(code: VeniceErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'VeniceAPIError';
    this.code = code;
    this.status = status;
  }
}

export function parseVeniceErrorText(text: string): string {
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message ?? parsed?.message ?? parsed?.detail;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {}
  return text.trim();
}

export function classifyVeniceError(status: number, message: string): VeniceErrorCode {
  // The status code decides. Matching on provider prose was misrouting errors:
  // a quota message that happens to name the model was reported as "model
  // unavailable", and a rejected key fell through to a generic error.
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'insufficient_credits';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider_unavailable';

  // Text is only a fallback for statuses that carry no meaning of their own.
  const normalized = message.toLowerCase();
  if (
    normalized.includes('insufficient')
    || normalized.includes('credit')
    || normalized.includes('balance')
    || normalized.includes('payment required')
  ) {
    return 'insufficient_credits';
  }
  if (normalized.includes('model') && (normalized.includes('not found') || normalized.includes('unavailable'))) {
    return 'model_unavailable';
  }
  return 'api_error';
}
