// Boltzmann transaction entropy: how many valid ways there are to read which
// input funded which output. High entropy means high ambiguity, the property a
// CoinJoin maximises. Original idea: LaurentMT / OXT Research.
//
// Ported from am-i-exposed (https://github.com/Copexit/am-i-exposed),
// src/lib/analysis/heuristics/combinatorics.ts and entropy-math.ts, (c) 2026
// Copexit, MIT licensed. Pure math, kept synchronous with a hard iteration cap so
// it never blocks; above the cap it estimates rather than enumerating.

/** Beyond this many inputs or outputs, mixed-value txs are estimated, not enumerated. */
export const MAX_ENUMERABLE_SIZE = 8;
const MAPPING_ITERATION_LIMIT = 10_000;

const factorialCache: number[] = [1, 1];
function factorial(n: number): number {
  if (n < factorialCache.length) return factorialCache[n];
  let result = factorialCache[factorialCache.length - 1];
  for (let i = factorialCache.length; i <= n; i++) { result *= i; factorialCache[i] = result; }
  return result;
}

function log2Factorial(n: number): number {
  let result = 0;
  for (let i = 2; i <= n; i++) result += Math.log2(i);
  return result;
}

function log2Binomial(n: number, k: number): number {
  if (k > n || k < 0 || k === 0 || k === n) return 0;
  let result = 0;
  for (let i = 1; i <= n - k; i++) result += Math.log2(k + i) - Math.log2(i);
  return result;
}

function integerPartitions(n: number): number[][] {
  const result: number[][] = [];
  const gen = (remaining: number, maxPart: number, current: number[]): void => {
    if (remaining === 0) { result.push([...current]); return; }
    for (let part = Math.min(remaining, maxPart); part >= 1; part--) {
      current.push(part);
      gen(remaining - part, part, current);
      current.pop();
    }
  };
  gen(n, n, []);
  return result;
}

/**
 * Number of valid interpretations for n equal inputs and n equal outputs.
 * Reference: n=2:3, n=3:16, n=4:131, n=5:1496, n=6:22482.
 */
export function boltzmannEqualOutputs(n: number): number {
  const partitions = integerPartitions(n);
  if (n <= 12) {
    const nFactSquared = factorial(n) * factorial(n);
    let total = 0;
    for (const partition of partitions) {
      let prodPartFactSquared = 1;
      for (const part of partition) { const pf = factorial(part); prodPartFactSquared *= pf * pf; }
      const mult = new Map<number, number>();
      for (const part of partition) mult.set(part, (mult.get(part) ?? 0) + 1);
      let prodMultFact = 1;
      for (const m of mult.values()) prodMultFact *= factorial(m);
      total += nFactSquared / (prodPartFactSquared * prodMultFact);
    }
    return Math.round(total);
  }
  const log2nFactSquared = 2 * log2Factorial(n);
  const logTerms: number[] = [];
  for (const partition of partitions) {
    let log2Denom = 0;
    for (const part of partition) log2Denom += 2 * log2Factorial(part);
    const mult = new Map<number, number>();
    for (const part of partition) mult.set(part, (mult.get(part) ?? 0) + 1);
    for (const m of mult.values()) log2Denom += log2Factorial(m);
    logTerms.push(log2nFactSquared - log2Denom);
  }
  let maxLog = -Infinity;
  for (const lt of logTerms) if (lt > maxLog) maxLog = lt;
  let sumExp = 0;
  for (const lt of logTerms) sumExp += Math.pow(2, lt - maxLog);
  return Math.pow(2, maxLog + Math.log2(sumExp));
}

function estimateBoltzmannEntropy(n: number): number {
  let logN = 0;
  for (let i = 2; i <= n; i++) logN += Math.log2(i);
  return logN + Math.log2(1.7);
}

/** All spendable outputs share one value: exact Boltzmann via partitions. */
function tryBoltzmannEqualOutputs(inputs: number[], outputs: number[]): { entropy: number } | null {
  if (outputs.length < 2 || inputs.length < 2) return null;
  const outputValue = outputs[0];
  if (!outputs.every(v => v === outputValue)) return null;
  const n = outputs.length;
  const k = inputs.filter(v => v >= outputValue).length;
  if (k < 2) return null;
  if (k >= n) {
    const extra = k > n ? log2Binomial(k, n) : 0;
    const base = n <= 50 ? (boltzmannEqualOutputs(n) > 1 ? Math.log2(boltzmannEqualOutputs(n)) : 0) : estimateBoltzmannEntropy(n);
    return { entropy: base + extra };
  }
  const outputChoice = log2Binomial(n, k);
  const base = k <= 50 ? (boltzmannEqualOutputs(k) > 1 ? Math.log2(boltzmannEqualOutputs(k)) : 0) : estimateBoltzmannEntropy(k);
  return { entropy: base + outputChoice };
}

/** One dominant equal tier (5+) plus unique change (JoinMarket-style). */
function trySingleDenominationBoltzmann(outputs: number[]): { entropy: number } | null {
  if (outputs.length < 5) return null;
  const counts = new Map<number, number>();
  for (const v of outputs) counts.set(v, (counts.get(v) ?? 0) + 1);
  let bestValue = 0, bestCount = 0;
  for (const [value, count] of counts) if (count >= 5 && count > bestCount) { bestCount = count; bestValue = value; }
  if (bestCount < 5 || bestValue === 0) return null;
  const otherTiers = [...counts.entries()].filter(([v, c]) => v !== bestValue && c >= 2);
  if (otherTiers.length > 0) return null;
  const n = bestCount;
  const entropy = n <= 50 ? (boltzmannEqualOutputs(n) > 1 ? Math.log2(boltzmannEqualOutputs(n)) : 0) : estimateBoltzmannEntropy(n);
  return { entropy };
}

/** Bounded assignment enumeration for small mixed-value transactions (lower bound). */
function countValidMappings(inputs: number[], outputs: number[]): { count: number; truncated: boolean } {
  const n = inputs.length, m = outputs.length;
  if (inputs.reduce((s, v) => s + v, 0) < outputs.reduce((s, v) => s + v, 0)) return { count: 1, truncated: false };
  let iterations = 0;
  const enumerate = (outputIdx: number, remaining: number[]): number => {
    if (iterations > MAPPING_ITERATION_LIMIT) return 0;
    if (outputIdx === m) { iterations++; return 1; }
    let valid = 0;
    const outVal = outputs[outputIdx];
    for (let i = 0; i < n; i++) {
      if (remaining[i] >= outVal) {
        remaining[i] -= outVal;
        valid += enumerate(outputIdx + 1, remaining);
        remaining[i] += outVal;
        if (iterations > MAPPING_ITERATION_LIMIT) break;
      }
    }
    return valid;
  };
  let count = enumerate(0, [...inputs]);
  const inputValueCounts = new Map<number, number>();
  for (const v of inputs) inputValueCounts.set(v, (inputValueCounts.get(v) ?? 0) + 1);
  let duplicateFactor = 1;
  for (const c of inputValueCounts.values()) if (c > 1) duplicateFactor *= factorial(c);
  count = Math.round(count / duplicateFactor);
  return { count: Math.max(count, 1), truncated: iterations > MAPPING_ITERATION_LIMIT };
}

/** Tier-decomposed estimate for large multi-denomination (WabiSabi) txs. */
function estimateEntropy(inputs: number[], outputs: number[]): number {
  if (inputs.length <= 1) return 0;
  const counts = new Map<number, number>();
  for (const v of outputs) counts.set(v, (counts.get(v) ?? 0) + 1);
  let total = 0;
  for (const [, k] of counts) {
    if (k >= 2) {
      const N = boltzmannEqualOutputs(Math.min(k, 50));
      total += N > 1 ? Math.log2(N) : 0;
    }
  }
  return total;
}

export type TransactionEntropy = { bits: number; method: string; truncated: boolean };

/** Best available entropy estimate for a transaction, in bits. */
export function transactionEntropy(inputs: number[], outputs: number[]): TransactionEntropy {
  if (inputs.length === 1 && outputs.length === 1) return { bits: 0, method: 'trivial', truncated: false };
  const eq = tryBoltzmannEqualOutputs(inputs, outputs);
  if (eq) return { bits: eq.entropy, method: 'Boltzmann partition', truncated: false };
  const single = trySingleDenominationBoltzmann(outputs);
  if (single) return { bits: single.entropy, method: 'Boltzmann partition', truncated: false };
  if (inputs.length <= MAX_ENUMERABLE_SIZE && outputs.length <= MAX_ENUMERABLE_SIZE) {
    const { count, truncated } = countValidMappings(inputs, outputs);
    return { bits: count > 1 ? Math.log2(count) : 0, method: 'assignment enumeration', truncated };
  }
  return { bits: estimateEntropy(inputs, outputs), method: 'multi-tier estimate', truncated: false };
}
