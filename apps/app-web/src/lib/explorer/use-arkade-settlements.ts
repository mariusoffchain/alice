// React binding for the Arkade settlement registry: keeps a component tree in
// step with the settlements identified on-chain, and drives the periodic chain
// walk while the Arkade network is being explored.

import { useEffect, useMemo, useState } from 'react';
import { settlementRegistry, updateSettlements, type ChainReader, type KnownSettlement } from './arkade-onchain.ts';

// A settlement lands on-chain every hour or two; re-walking every few minutes
// keeps the tip fresh without hammering either endpoint (each idle pass is a
// couple of requests).
const WALK_INTERVAL_MS = 5 * 60_000;

export type ArkadeSettlements = {
  /** Every settlement this browser has identified, by txid. */
  byTxid: Map<string, KnownSettlement>;
  /** Confirmed settlement block heights, for the ribbon highlights. */
  heights: Set<number>;
};

/**
 * The known Arkade settlements, live. While `chain` is set (the Arkade network
 * is active), a background walk extends the set to the on-chain tip and pages
 * backward into history; with `chain` null the hook only mirrors the registry.
 */
export function useArkadeSettlements(chain: ChainReader | null, arkApiUrl: string | undefined): ArkadeSettlements {
  // A monotonically increasing version, bumped on every registry change; the
  // maps handed out are rebuilt from the registry when it changes.
  const [version, setVersion] = useState(0);

  useEffect(() => settlementRegistry.subscribe(() => setVersion(v => v + 1)), []);

  useEffect(() => {
    if (!chain || !arkApiUrl) return;
    const controller = new AbortController();
    let cancelled = false;
    let inFlight = false;
    async function walk() {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        await updateSettlements(chain!, arkApiUrl!, { signal: controller.signal });
      } catch { /* a failed pass retries on the next tick */ } finally {
        inFlight = false;
      }
    }
    void walk();
    const id = setInterval(walk, WALK_INTERVAL_MS);
    return () => { cancelled = true; controller.abort(); clearInterval(id); };
  }, [chain, arkApiUrl]);

  return useMemo<ArkadeSettlements>(() => {
    void version; // rebuild when the registry changes
    const byTxid = new Map<string, KnownSettlement>();
    for (const s of settlementRegistry.all()) byTxid.set(s.txid, s);
    return { byTxid, heights: settlementRegistry.heights() };
  }, [version]);
}
