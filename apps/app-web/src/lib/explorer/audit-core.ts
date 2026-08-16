// audit-core: the de-identified projection of the deterministic engine, the ONLY
// thing a language model is ever allowed to see. Implements CONTRAT 1 of
// CONTRATS_AUDIT_ALICE.md.
//
// Two invariants govern this file:
//  1. Fail-closed. A rule projects to an AbstractSignal only if it declares a
//     projector here. There is no generic default: an undeclared rule yields
//     null, so a field added to PrivacySignal later cannot leak by accident.
//  2. No identifier ever crosses. The de-identification test (contract 1.4)
//     forbids exact amounts, absolute timestamps, block heights, addresses,
//     txids, outpoints, xpubs, entity names, and feeRate. Only shapes, counts,
//     magnitude/age buckets, structural booleans and category labels pass.
//
// What is shown in the UI attachment chip IS this object (contract 1.6), so
// there is a single source of truth for "shown" and "sent".

import type { PrivacySignal, RuleId, SignalConfidence, SignalSeverity } from './signals.ts';

// Order of magnitude of a sat amount, never the amount. e5 = 10^5..10^6 sats.
export type MagnitudeBucket = 'dust' | 'e3' | 'e4' | 'e5' | 'e6' | 'e7' | 'e8+';
// Relative age, never an absolute timestamp.
export type AgeBucket = '<1d' | '1-7d' | '1-4w' | '1-6m' | '6m-2y' | '2y+';

// Category only. A category is analytic; a name is identifying, so names never
// project here (contract 1.3): they leave only on explicit, per-request consent.
export type EntityCategory =
  | 'exchange' | 'payment' | 'gambling' | 'scam'
  | 'darknet' | 'mining' | 'mixer' | 'p2p' | 'asp' | 'sanctioned' | 'unknown';

export const REDACTION_PROFILE = 'v1';

export interface AbstractSignal {
  /** Local to the session, deliberately not derivable from any chain value. */
  abstractId: string;
  ruleId: RuleId;
  ruleVersion: number;

  severity: SignalSeverity;
  confidence: SignalConfidence;

  /** Shapes and counts, never values. */
  shape: {
    addresses: number;
    txs: number;
    utxos: number;
    inputCount?: number;
    outputCount?: number;
    scriptTypes?: string[];
  };

  magnitudes?: MagnitudeBucket[];
  ages?: AgeBucket[];

  /** Structural booleans: they carry analysis, not identity. */
  flags?: Record<string, boolean>;

  entityCategories?: EntityCategory[];

  /** Links to other AbstractSignals of the same session, by abstractId. */
  relatedTo?: string[];

  redactionProfile: string;
}

// Rule versions live here so an archived AbstractSignal stays readable when a
// rule evolves. When PrivacySignal gains its own ruleVersion, prefer that.
const RULE_VERSIONS: Record<RuleId, number> = {
  ADDRESS_REUSE: 1,
  ENTITY_LINK: 1,
  QUANTUM_EXPOSURE: 1,
  CHANGE_DETECTION: 1,
  WALLET_FINGERPRINT: 1,
  SCRIPT_TYPE_MIX: 1,
  ROUND_AMOUNT: 1,
  CONSOLIDATION: 1,
  COINJOIN: 1,
  CIOH: 1,
  PEEL_CHAIN: 1,
  DUST_OUTPUT: 1,
  DUST_SPENDING: 1,
  ANONYMITY_SET: 1,
  ENTROPY: 1,
  POSTMIX: 1,
  PREMIX: 1,
  // v2: TX gained scriptTypes, BLOCK gained a total-fees magnitude bucket.
  TX_CONTEXT: 2,
  ADDRESS_CONTEXT: 1,
  BLOCK_CONTEXT: 2,
};

// The category vocabulary, as a runtime list, so a projected category can be
// validated against it (a name must never reach here, only a category can).
const ENTITY_CATEGORIES: EntityCategory[] = [
  'exchange', 'payment', 'gambling', 'scam', 'darknet', 'mining', 'mixer', 'p2p', 'asp', 'sanctioned', 'unknown',
];
function isEntityCategory(v: string): v is EntityCategory {
  return (ENTITY_CATEGORIES as string[]).includes(v);
}

const MAGNITUDE_BUCKETS: MagnitudeBucket[] = ['dust', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8+'];
function isMagnitudeBucket(v: string): v is MagnitudeBucket {
  return (MAGNITUDE_BUCKETS as string[]).includes(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Bucket a sat amount by order of magnitude. Never returns the amount. */
export function magnitudeBucket(sats: number): MagnitudeBucket {
  const v = Math.max(0, Math.floor(sats));
  if (v < 1_000) return 'dust';
  if (v < 10_000) return 'e3';
  if (v < 100_000) return 'e4';
  if (v < 1_000_000) return 'e5';
  if (v < 10_000_000) return 'e6';
  if (v < 100_000_000) return 'e7';
  return 'e8+';
}

/** Bucket an elapsed duration (seconds) into a relative age. */
export function ageBucket(elapsedSeconds: number): AgeBucket {
  const s = Math.max(0, elapsedSeconds);
  const day = 86_400;
  if (s < day) return '<1d';
  if (s < 7 * day) return '1-7d';
  if (s < 28 * day) return '1-4w';
  if (s < 182 * day) return '1-6m';
  if (s < 730 * day) return '6m-2y';
  return '2y+';
}

function newAbstractId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `as_${crypto.randomUUID()}`;
  return `as_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// A projector returns the analytic core of an AbstractSignal. The wrapper adds
// the session-local abstractId and the cross-signal links, so a projector never
// has to think about identity or session state, only about what its rule reveals.
type ProjectionCore = Omit<AbstractSignal, 'abstractId' | 'relatedTo'>;
type RuleProjector = (signal: PrivacySignal) => ProjectionCore;

// ADDRESS_REUSE declares its projection: one address, reused within a single
// transaction and/or across its on-chain history, plus (when known) how many
// transactions have touched it. Only counts and booleans, no address, no value.
const projectAddressReuse: RuleProjector = (signal) => {
  const ev = signal.evidence;
  const intraTransaction = ev.intraTransaction === true;
  const historical = ev.historical === true;
  const txs = typeof ev.txCount === 'number' ? ev.txCount : 0;
  return {
    ruleId: signal.ruleId,
    ruleVersion: RULE_VERSIONS[signal.ruleId],
    severity: signal.severity,
    confidence: signal.confidence,
    shape: { addresses: signal.subjects.length, txs, utxos: 0 },
    flags: { intraTransaction, historical },
    redactionProfile: REDACTION_PROFILE,
  };
};

// The context rules project the page's shape: only counts and buckets, never a
// value, never an identifier. The raw sats and seconds stay in the evidence,
// on this device; the buckets are what cross.
const projectTxContext: RuleProjector = (signal) => ({
  ruleId: signal.ruleId,
  ruleVersion: RULE_VERSIONS[signal.ruleId],
  severity: signal.severity,
  confidence: signal.confidence,
  shape: {
    addresses: num(signal.evidence.addressCount),
    txs: 1,
    utxos: 0,
    inputCount: num(signal.evidence.inputCount),
    outputCount: num(signal.evidence.outputCount),
    // Script kinds carry analysis (fingerprinting surface), never identity.
    ...(typeof signal.evidence.scriptTypes === 'string' && signal.evidence.scriptTypes.length > 0
      ? { scriptTypes: signal.evidence.scriptTypes.split(',') }
      : {}),
  },
  magnitudes: [magnitudeBucket(num(signal.evidence.totalOutSats))],
  redactionProfile: REDACTION_PROFILE,
});

const projectAddressContext: RuleProjector = (signal) => ({
  ruleId: signal.ruleId,
  ruleVersion: RULE_VERSIONS[signal.ruleId],
  severity: signal.severity,
  confidence: signal.confidence,
  shape: { addresses: 1, txs: num(signal.evidence.txCount), utxos: 0 },
  magnitudes: [magnitudeBucket(num(signal.evidence.balanceSats))],
  redactionProfile: REDACTION_PROFILE,
});

const projectBlockContext: RuleProjector = (signal) => ({
  ruleId: signal.ruleId,
  ruleVersion: RULE_VERSIONS[signal.ruleId],
  severity: signal.severity,
  confidence: signal.confidence,
  shape: { addresses: 0, txs: num(signal.evidence.txCount), utxos: 0 },
  ages: [ageBucket(num(signal.evidence.elapsedSeconds))],
  ...(typeof signal.evidence.totalFeesSats === 'number'
    ? { magnitudes: [magnitudeBucket(num(signal.evidence.totalFeesSats))] }
    : {}),
  redactionProfile: REDACTION_PROFILE,
});

// The registry is intentionally Partial: a ruleId with no entry has declared no
// projection, so toAbstractSignal returns null for it. This is the fail-closed
// default, in code, not in a comment.
// ENTITY_LINK declares its projection: only the entity CATEGORIES cross (exchange,
// mixer, sanctioned...), never the entity name (contract 1.3). The name stays in
// the PrivacySignal's detail, on this device; the evidence carries categories only.
const projectEntityLink: RuleProjector = (signal) => {
  const cats = String(signal.evidence.categories ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(isEntityCategory);
  return {
    ruleId: signal.ruleId,
    ruleVersion: RULE_VERSIONS[signal.ruleId],
    severity: signal.severity,
    confidence: signal.confidence,
    shape: { addresses: signal.subjects.length, txs: 0, utxos: 0 },
    entityCategories: cats.length ? [...new Set(cats)] : undefined,
    redactionProfile: REDACTION_PROFILE,
  };
};

// QUANTUM_EXPOSURE: whether the address's public key is already on-chain, plus a
// magnitude bucket of the balance at risk. Booleans and a bucket only, no value.
const projectQuantumExposure: RuleProjector = (signal) => {
  const bucket = signal.evidence.balanceBucket;
  const magnitudes = typeof bucket === 'string' && isMagnitudeBucket(bucket) ? [bucket] : undefined;
  return {
    ruleId: signal.ruleId,
    ruleVersion: RULE_VERSIONS[signal.ruleId],
    severity: signal.severity,
    confidence: signal.confidence,
    shape: { addresses: signal.subjects.length, txs: 0, utxos: 0 },
    flags: { exposedBySpend: signal.evidence.exposedBySpend === true, taproot: signal.evidence.taproot === true },
    magnitudes,
    redactionProfile: REDACTION_PROFILE,
  };
};

// CHANGE_DETECTION / WALLET_FINGERPRINT: input/output counts and the structural
// booleans that fired, never a value or an address.
const projectChangeDetection: RuleProjector = (signal) => ({
  ruleId: signal.ruleId,
  ruleVersion: RULE_VERSIONS[signal.ruleId],
  severity: signal.severity,
  confidence: signal.confidence,
  shape: {
    addresses: 0,
    txs: 0,
    utxos: 0,
    inputCount: typeof signal.evidence.inputCount === 'number' ? signal.evidence.inputCount : undefined,
    outputCount: typeof signal.evidence.outputCount === 'number' ? signal.evidence.outputCount : undefined,
  },
  flags: {
    selfSend: signal.evidence.selfSend === true,
    roundAmount: signal.evidence.roundAmount === true,
    deterministic: signal.evidence.deterministic === true,
  },
  redactionProfile: REDACTION_PROFILE,
});

const projectWalletFingerprint: RuleProjector = (signal) => ({
  ruleId: signal.ruleId,
  ruleVersion: RULE_VERSIONS[signal.ruleId],
  severity: signal.severity,
  confidence: signal.confidence,
  shape: {
    addresses: 0,
    txs: 0,
    utxos: 0,
    inputCount: typeof signal.evidence.inputCount === 'number' ? signal.evidence.inputCount : undefined,
    outputCount: typeof signal.evidence.outputCount === 'number' ? signal.evidence.outputCount : undefined,
  },
  flags: { bip69: signal.evidence.bip69 === true },
  redactionProfile: REDACTION_PROFILE,
});

// A shared projector for the transaction-shape heuristics: input/output counts
// plus the named structural booleans, never a value or an address.
function txShapeProjector(flagKeys: readonly string[]): RuleProjector {
  return (signal) => {
    const flags: Record<string, boolean> = {};
    for (const k of flagKeys) flags[k] = signal.evidence[k] === true;
    return {
      ruleId: signal.ruleId,
      ruleVersion: RULE_VERSIONS[signal.ruleId],
      severity: signal.severity,
      confidence: signal.confidence,
      shape: {
        addresses: 0,
        txs: 0,
        utxos: 0,
        inputCount: typeof signal.evidence.inputCount === 'number' ? signal.evidence.inputCount : undefined,
        outputCount: typeof signal.evidence.outputCount === 'number' ? signal.evidence.outputCount : undefined,
      },
      flags,
      redactionProfile: REDACTION_PROFILE,
    };
  };
}

const RULE_PROJECTORS: Partial<Record<RuleId, RuleProjector>> = {
  ADDRESS_REUSE: projectAddressReuse,
  ENTITY_LINK: projectEntityLink,
  QUANTUM_EXPOSURE: projectQuantumExposure,
  CHANGE_DETECTION: projectChangeDetection,
  WALLET_FINGERPRINT: projectWalletFingerprint,
  SCRIPT_TYPE_MIX: txShapeProjector(['uniform', 'mixed', 'multisig']),
  ROUND_AMOUNT: txShapeProjector(['someRound', 'allRound']),
  CONSOLIDATION: txShapeProjector(['fanIn', 'fanOut', 'crossType']),
  COINJOIN: txShapeProjector(['coinjoin', 'whirlpool']),
  CIOH: txShapeProjector(['singleInput', 'clustered', 'heavyCluster']),
  PEEL_CHAIN: txShapeProjector(['peelChain']),
  DUST_OUTPUT: txShapeProjector(['dustAttack']),
  DUST_SPENDING: txShapeProjector(['dustSpending']),
  ANONYMITY_SET: txShapeProjector(['strongAnonset', 'someAnonset']),
  ENTROPY: txShapeProjector(['highEntropy']),
  POSTMIX: txShapeProjector(['postmixMixed', 'postmixConsolidation']),
  PREMIX: txShapeProjector(['premix', 'toxicChange']),
  TX_CONTEXT: projectTxContext,
  ADDRESS_CONTEXT: projectAddressContext,
  BLOCK_CONTEXT: projectBlockContext,
};

/**
 * Project one PrivacySignal to its declared AbstractSignal, or null when the
 * rule declares no projection. Null is a valid, expected result, not an error.
 */
export function toAbstractSignal(signal: PrivacySignal): AbstractSignal | null {
  const project = RULE_PROJECTORS[signal.ruleId];
  if (!project) return null;
  const core = project(signal);
  return { ...core, abstractId: newAbstractId(), relatedTo: [] };
}

/**
 * Project a batch, dropping the rules with no declared projection, and link the
 * survivors that share a subject on-chain. The linkage is expressed only through
 * session-local abstractIds, so the raw subject that justified it never crosses.
 */
export function toAbstractSignals(signals: readonly PrivacySignal[]): AbstractSignal[] {
  const pairs = signals
    .map(signal => ({ signal, abstract: toAbstractSignal(signal) }))
    .filter((p): p is { signal: PrivacySignal; abstract: AbstractSignal } => p.abstract !== null);

  for (let i = 0; i < pairs.length; i++) {
    const subjectsI = new Set(pairs[i].signal.subjects);
    for (let j = 0; j < pairs.length; j++) {
      if (i === j) continue;
      if (pairs[j].signal.subjects.some(s => subjectsI.has(s))) {
        pairs[i].abstract.relatedTo!.push(pairs[j].abstract.abstractId);
      }
    }
  }

  return pairs.map(p => p.abstract);
}

// Human-readable severity/confidence for the model, kept short and plain.
const SEVERITY_TEXT: Record<SignalSeverity, string> = {
  info: 'informational',
  low: 'low',
  medium: 'medium',
  high: 'high',
};
const CONFIDENCE_TEXT: Record<SignalConfidence, string> = {
  certain: 'certain',
  strong: 'strong',
  possible: 'possible',
  unknown: 'inconclusive',
};

const RULE_LABEL: Record<RuleId, string> = {
  ADDRESS_REUSE: 'address reuse',
  ENTITY_LINK: 'known entity',
  QUANTUM_EXPOSURE: 'quantum-exposed key',
  CHANGE_DETECTION: 'change detection',
  WALLET_FINGERPRINT: 'wallet fingerprint',
  SCRIPT_TYPE_MIX: 'script type mix',
  ROUND_AMOUNT: 'round amount',
  CONSOLIDATION: 'consolidation',
  COINJOIN: 'coinjoin',
  CIOH: 'common input ownership',
  PEEL_CHAIN: 'peel chain',
  DUST_OUTPUT: 'dust attack',
  DUST_SPENDING: 'dust spending',
  ANONYMITY_SET: 'anonymity set',
  ENTROPY: 'transaction entropy',
  POSTMIX: 'postmix spending',
  PREMIX: 'coinjoin premix',
  TX_CONTEXT: 'transaction shape',
  ADDRESS_CONTEXT: 'address activity',
  BLOCK_CONTEXT: 'block contents',
};

/**
 * Render an AbstractSignal as the plain text a language model consumes. This is
 * the function injected into message-parts' partsToText, and it must only ever
 * read fields that already passed de-identification, so it cannot leak: it reads
 * the AbstractSignal, never the PrivacySignal.
 */
export function renderAbstractSignal(a: AbstractSignal): string {
  const parts: string[] = [];
  parts.push(
    `Privacy signal: ${RULE_LABEL[a.ruleId] ?? a.ruleId} (severity ${SEVERITY_TEXT[a.severity]}, confidence ${CONFIDENCE_TEXT[a.confidence]}).`,
  );

  const shapeBits: string[] = [];
  if (a.shape.addresses) shapeBits.push(`${a.shape.addresses} address${a.shape.addresses > 1 ? 'es' : ''}`);
  if (a.shape.txs) shapeBits.push(`${a.shape.txs} transaction${a.shape.txs > 1 ? 's' : ''}`);
  if (a.shape.utxos) shapeBits.push(`${a.shape.utxos} unspent output${a.shape.utxos > 1 ? 's' : ''}`);
  if (typeof a.shape.inputCount === 'number') shapeBits.push(`${a.shape.inputCount} inputs`);
  if (typeof a.shape.outputCount === 'number') shapeBits.push(`${a.shape.outputCount} outputs`);
  if (shapeBits.length) parts.push(`Shape: ${shapeBits.join(', ')}.`);

  const trueFlags = a.flags ? Object.keys(a.flags).filter(k => a.flags![k]) : [];
  if (trueFlags.length) parts.push(`Traits: ${trueFlags.join(', ')}.`);

  if (a.magnitudes?.length) parts.push(`Amount magnitudes (buckets, not values): ${a.magnitudes.join(', ')}.`);
  if (a.ages?.length) parts.push(`Ages (relative): ${a.ages.join(', ')}.`);
  if (a.entityCategories?.length) parts.push(`Entity categories: ${a.entityCategories.join(', ')}.`);

  return parts.join(' ');
}
