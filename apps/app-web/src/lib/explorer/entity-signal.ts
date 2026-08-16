// Turn an address's sourced entity attribution into a PrivacySignal, so a known
// exchange, mixer or sanctioned link feeds the audit and Alice like any other
// signal. The entity NAME lives only in the signal's detail (shown on-device);
// the evidence carries categories only, which is all the ENTITY_LINK projector
// lets cross to the model (contract 1.3).

import type { EntityCategory } from './audit-core.ts';
import type { EntityLabel } from './entities.ts';
import type { PrivacySignal, SignalConfidence, SignalSeverity } from './signals.ts';

// A sanctioned, scam or darknet link is a serious exposure; an exchange, mixer,
// gambling or payment link is medium; anything else is low.
const HIGH: EntityCategory[] = ['sanctioned', 'scam', 'darknet'];
const MEDIUM: EntityCategory[] = ['exchange', 'mixer', 'gambling', 'payment'];

function severityFor(categories: EntityCategory[]): SignalSeverity {
  if (categories.some(c => HIGH.includes(c))) return 'high';
  if (categories.some(c => MEDIUM.includes(c))) return 'medium';
  return 'low';
}

function confidenceFor(labels: readonly EntityLabel[]): SignalConfidence {
  // Labels arrive strongest-first from the store.
  const strongest = labels[0]?.confidence;
  return strongest === 'certain' ? 'certain' : strongest === 'strong' ? 'strong' : 'possible';
}

/**
 * A single ENTITY_LINK signal for an address that matches known attributions.
 * Returns [] when nothing is known: attribution is never invented here.
 */
export function detectEntityLink(address: string, labels: readonly EntityLabel[]): PrivacySignal[] {
  if (labels.length === 0) return [];
  const categories = [...new Set(labels.map(l => l.category))];
  const names = [...new Set(labels.map(l => l.name))];
  return [{
    id: `ENTITY_LINK:${address}`,
    ruleId: 'ENTITY_LINK',
    severity: severityFor(categories),
    confidence: confidenceFor(labels),
    title: 'Known entity',
    detail:
      `This address is attributed to ${names.join(', ')} (${categories.join(', ')}). ` +
      'Anyone using the same public sources can make the same link, so activity here is tied to that entity.',
    subjects: [address],
    // Categories only, never the name, so the projection stays de-identified.
    evidence: { categories: categories.join(','), labelCount: labels.length },
  }];
}
