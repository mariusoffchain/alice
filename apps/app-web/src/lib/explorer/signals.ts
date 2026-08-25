// Privacy signals produced by the deterministic engine. This is a scoped first
// version aligned with the CONTRATS_AUDIT_ALICE PrivacySignal model: severity
// and confidence are always separate and never merged, every signal carries the
// subjects and the evidence that prove it, and the engine is the sole source of
// facts. The AbstractSignal projection (for sending to Alice) is added later.

import type { NormalizedBlock, NormalizedTransaction } from './types.ts';

export type SignalSeverity = 'info' | 'low' | 'medium' | 'high';

// A grave leak can be uncertain; a certain fact can be minor. The two axes stay
// independent by design.
export type SignalConfidence = 'certain' | 'strong' | 'possible' | 'unknown';

export type RuleId =
  | 'ADDRESS_REUSE' | 'ENTITY_LINK' | 'QUANTUM_EXPOSURE'
  | 'CHANGE_DETECTION' | 'WALLET_FINGERPRINT' | 'SCRIPT_TYPE_MIX' | 'ROUND_AMOUNT' | 'CONSOLIDATION' | 'COINJOIN'
  | 'CIOH' | 'PEEL_CHAIN' | 'DUST_OUTPUT' | 'DUST_SPENDING' | 'ANONYMITY_SET' | 'ENTROPY' | 'POSTMIX' | 'PREMIX'
  | 'TX_CONTEXT' | 'ADDRESS_CONTEXT' | 'BLOCK_CONTEXT';

export type PrivacySignal = {
  /** Stable within a session: ruleId plus its subjects. */
  id: string;
  ruleId: RuleId;
  severity: SignalSeverity;
  confidence: SignalConfidence;
  /** Short label shown on the signal card. */
  title: string;
  /** What this actually reveals, in plain terms. */
  detail: string;
  /** The addresses (or other subjects) the signal is about. */
  subjects: string[];
  /** Reproducible facts behind the signal. */
  evidence: Record<string, string | number | boolean>;
};

/** On-chain stats for an address, enough to judge reuse across its history. */
export type AddressStats = {
  address: string;
  /** How many outputs have ever paid this address. > 1 means it was reused. */
  fundedCount: number;
  spentCount: number;
  txCount: number;
  /** Total sats ever received / spent, for the balance (received - spent). */
  fundedSum: number;
  spentSum: number;
};

type Occurrence = { inInputs: number; inOutputs: number };

function bump(map: Map<string, Occurrence>, addr: string, where: 'in' | 'out') {
  const e = map.get(addr) ?? { inInputs: 0, inOutputs: 0 };
  if (where === 'in') e.inInputs += 1;
  else e.inOutputs += 1;
  map.set(addr, e);
}

/**
 * ADDRESS_REUSE. Two independent, certain grounds:
 *  - intra-transaction: the same address appears more than once in this tx, so
 *    those coins are visibly the same owner.
 *  - historical: the address has received funds more than once on-chain
 *    (fundedCount > 1), which ties all those payments together in public.
 *
 * Pure: the historical part reads a provided stats map, it does not fetch.
 * An address with no stats entry is judged on the intra-transaction ground only.
 */
export function detectAddressReuse(
  tx: NormalizedTransaction,
  statsByAddress?: ReadonlyMap<string, AddressStats>,
): PrivacySignal[] {
  const occ = new Map<string, Occurrence>();
  for (const i of tx.inputs) if (i.address) bump(occ, i.address, 'in');
  for (const o of tx.outputs) if (o.address) bump(occ, o.address, 'out');

  const signals: PrivacySignal[] = [];

  for (const [address, e] of occ) {
    const withinTxCount = e.inInputs + e.inOutputs;
    const intraReuse = withinTxCount > 1;

    const stats = statsByAddress?.get(address);
    const historyReuse = stats !== undefined && stats.fundedCount > 1;

    if (!intraReuse && !historyReuse) continue;

    const reasons: string[] = [];
    if (historyReuse) {
      reasons.push(
        `This address has received funds ${stats!.fundedCount} times on-chain. Reusing it publicly ties all those payments to the same owner.`,
      );
    }
    if (intraReuse) {
      reasons.push(
        `It appears ${withinTxCount} times in this transaction (${e.inInputs} input(s), ${e.inOutputs} output(s)), directly linking these coins.`,
      );
    }

    signals.push({
      id: `ADDRESS_REUSE:${address}`,
      ruleId: 'ADDRESS_REUSE',
      severity: 'medium',
      confidence: 'certain',
      title: 'Address reuse',
      detail: reasons.join(' '),
      subjects: [address],
      evidence: {
        address,
        inInputs: e.inInputs,
        inOutputs: e.inOutputs,
        ...(stats ? { fundedCount: stats.fundedCount, txCount: stats.txCount } : {}),
        intraTransaction: intraReuse,
        historical: historyReuse,
      },
    });
  }

  // Most severe first; within a rule, keep deterministic order by subject.
  return signals.sort((a, b) => a.subjects[0].localeCompare(b.subjects[0]));
}

// Identified-mode descriptions: the page's REAL details as plain text, with
// identifiers and values. Deterministic renderings of already-fetched data,
// nothing inferred. They exist for the explicit identified mode only: route()
// classifies any message carrying them as class D, so they can reach the
// attested cloud only behind the identifiedConsent + cloudConsent gates, and
// a local model otherwise.

function sats(btcSats: number): string {
  return `${btcSats} sats (${(btcSats / 1e8).toFixed(8)} BTC)`;
}

export function buildFullTxDescription(tx: NormalizedTransaction): string {
  const lines: string[] = [];
  lines.push(`Transaction ${tx.txid}`);
  lines.push(`Status: ${tx.status.confirmed ? `confirmed${tx.status.blockHeight != null ? ` in block ${tx.status.blockHeight}` : ''}` : 'unconfirmed'}. Fee: ${tx.feeSats} sats (${tx.feeRateSatVb ?? '?'} sat/vB). Size: ${tx.vsize} vB.`);
  lines.push(`Inputs (${tx.inputs.length}):`);
  for (const i of tx.inputs) {
    lines.push(`- ${i.isCoinbase ? 'coinbase' : `${i.address ?? 'no address'}${i.valueSats != null ? `, ${sats(i.valueSats)}` : ''}${i.scriptType ? ` [${i.scriptType}]` : ''}`}`);
  }
  lines.push(`Outputs (${tx.outputs.length}):`);
  for (const o of tx.outputs) {
    lines.push(`- ${o.address ?? 'no address'}, ${sats(o.valueSats)}${o.scriptType ? ` [${o.scriptType}]` : ''}${o.spent === true ? ' (spent)' : o.spent === false ? ' (unspent)' : ''}`);
  }
  return lines.join('\n');
}

export function buildFullAddressDescription(stats: AddressStats): string {
  const balance = Math.max(0, stats.fundedSum - stats.spentSum);
  return [
    `Address ${stats.address}`,
    `Received ${stats.fundedCount} time(s) for a total of ${sats(stats.fundedSum)}; spent ${stats.spentCount} time(s) for ${sats(stats.spentSum)}.`,
    `Current balance: ${sats(balance)}. Transactions touching it: ${stats.txCount}.`,
  ].join('\n');
}

export function buildFullBlockDescription(block: NormalizedBlock): string {
  return [
    `Block ${block.height} (hash ${block.id})`,
    `Mined ${new Date(block.timestamp * 1000).toISOString()}${block.poolName ? ` by ${block.poolName}` : ''}.`,
    `${block.txCount} transactions, ${block.size} bytes${block.totalFees != null ? `, total fees ${sats(block.totalFees)}` : ''}${block.medianFee != null ? `, median fee rate ${block.medianFee} sat/vB` : ''}.`,
  ].join('\n');
}

/**
 * Identified-mode rendering of the engine's findings: titles and full details,
 * real subjects included. For the explicit identified mode only, where the
 * page's real description already rides along; context signals (severity
 * info) are omitted since the description carries those facts already.
 */
export function renderSignalsIdentified(signals: readonly PrivacySignal[]): string {
  const findings = signals.filter(s => s.severity !== 'info');
  if (findings.length === 0) return '';
  return [
    'Deterministic privacy findings:',
    ...findings.map(s => `- ${s.title} (${s.severity}, ${s.confidence}): ${s.detail} Subjects: ${s.subjects.join(', ')}.`),
  ].join('\n');
}

// Deterministic page-context signals: what the page IS, as raw counts in the
// evidence; the projection to AbstractSignal turns them into de-identified
// shape, magnitude buckets and age buckets. Informational severity: they
// reveal nothing new, they give Alice the shape of what the user is looking
// at. Pure: they read already-fetched normalized data, no fetching.

/** The shape of one transaction: inputs, outputs, distinct addresses, value. */
export function buildTxContext(tx: NormalizedTransaction): PrivacySignal {
  const addresses = new Set<string>();
  for (const i of tx.inputs) if (i.address) addresses.add(i.address);
  for (const o of tx.outputs) if (o.address) addresses.add(o.address);
  const totalOutSats = tx.outputs.reduce((s, o) => s + o.valueSats, 0);
  // Script types carry analysis (wallet fingerprinting surface), not identity.
  const scriptTypes = Array.from(new Set(
    [...tx.inputs, ...tx.outputs].flatMap(io => (io.scriptType ? [io.scriptType] : [])),
  )).sort();
  return {
    id: `TX_CONTEXT:${tx.txid}`,
    ruleId: 'TX_CONTEXT',
    severity: 'info',
    confidence: 'certain',
    title: 'Transaction shape',
    detail: `${tx.inputs.length} input(s) into ${tx.outputs.length} output(s).`,
    subjects: [tx.txid],
    evidence: {
      inputCount: tx.inputs.length,
      outputCount: tx.outputs.length,
      addressCount: addresses.size,
      totalOutSats,
      scriptTypes: scriptTypes.join(','),
    },
  };
}

/** The activity of one address: transaction count and held balance. */
export function buildAddressContext(stats: AddressStats): PrivacySignal {
  return {
    id: `ADDRESS_CONTEXT:${stats.address}`,
    ruleId: 'ADDRESS_CONTEXT',
    severity: 'info',
    confidence: 'certain',
    title: 'Address activity',
    detail: `${stats.txCount} transaction(s) touch this address.`,
    subjects: [stats.address],
    evidence: {
      txCount: stats.txCount,
      balanceSats: Math.max(0, stats.fundedSum - stats.spentSum),
    },
  };
}

/** The contents of one block: transaction count and how old it is. */
export function buildBlockContext(
  block: { id: string; txCount: number; timestamp: number; totalFees?: number },
  nowSec: number,
): PrivacySignal {
  return {
    id: `BLOCK_CONTEXT:${block.id}`,
    ruleId: 'BLOCK_CONTEXT',
    severity: 'info',
    confidence: 'certain',
    title: 'Block contents',
    detail: `${block.txCount} transaction(s) in this block.`,
    subjects: [block.id],
    evidence: {
      txCount: block.txCount,
      elapsedSeconds: Math.max(0, nowSec - block.timestamp),
      ...(block.totalFees != null ? { totalFeesSats: block.totalFees } : {}),
    },
  };
}

/**
 * ADDRESS_REUSE for an address page: the historical ground alone, judged from
 * the stats the page already fetched. Same rule, same severity and confidence
 * as the transaction-level detector, so the projection to AbstractSignal is
 * shared. Pure: no fetching.
 */
export function detectAddressReuseForAddress(stats: AddressStats): PrivacySignal[] {
  if (stats.fundedCount <= 1) return [];
  return [{
    id: `ADDRESS_REUSE:${stats.address}`,
    ruleId: 'ADDRESS_REUSE',
    severity: 'medium',
    confidence: 'certain',
    title: 'Address reuse',
    detail: `This address has received funds ${stats.fundedCount} times on-chain. Reusing it publicly ties all those payments to the same owner.`,
    subjects: [stats.address],
    evidence: {
      address: stats.address,
      inInputs: 0,
      inOutputs: 0,
      fundedCount: stats.fundedCount,
      txCount: stats.txCount,
      intraTransaction: false,
      historical: true,
    },
  }];
}
