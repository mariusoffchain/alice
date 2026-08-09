// Cache only public Intel DCAP collateral. Attestations themselves are never
// cached: every E2EE send fetches a fresh quote bound to a fresh nonce.

/** Absolute upper bound even when the collateral advertises a later expiry. */
export const MAX_COLLATERAL_TTL_MS = 60 * 60 * 1000;

type Entry = {
  collateral: unknown;
  expiresAt: number;
};

function readNextUpdate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    const nextUpdate =
      parsed?.tcbInfo?.nextUpdate ??
      parsed?.enclaveIdentity?.nextUpdate ??
      parsed?.qeIdentity?.nextUpdate;
    const timestamp = typeof nextUpdate === 'string' ? Date.parse(nextUpdate) : NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

/**
 * Clamp cache lifetime to both Alice's TTL and the signed TCB/QE expiry carried
 * by the collateral. The verifier still validates CRL freshness on every use.
 */
export function collateralExpiry(collateral: any, now: number = Date.now()): number {
  const candidates = [
    now + MAX_COLLATERAL_TTL_MS,
    readNextUpdate(collateral?.tcb_info),
    readNextUpdate(collateral?.qe_identity),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return Math.min(...candidates);
}

export class CollateralCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<unknown>>();

  get(key: string, now: number = Date.now()): unknown | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.collateral;
  }

  set(key: string, collateral: unknown, expiresAt: number): void {
    this.entries.set(key, { collateral, expiresAt });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.inflight.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /**
   * Deduplicate only collateral downloads. The quote and nonce verification
   * still run independently for every E2EE request.
   */
  async getOrFetch(
    key: string,
    fetchCollateral: () => Promise<unknown>,
    now: number = Date.now(),
  ): Promise<unknown> {
    const cached = this.get(key, now);
    if (cached) return cached;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const run = (async () => {
      const collateral = await fetchCollateral();
      this.set(key, collateral, collateralExpiry(collateral, now));
      return collateral;
    })();
    this.inflight.set(key, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(key);
    }
  }
}
