import type { KnowledgeConcept } from '@alice-wallet/alice-ai';

// Which knowledge concepts a PlanB course teaches, by course code.
//
// This is the bridge between Learn and the pedagogical profile: reading a
// chapter sends a study signal for these concepts, and finishing the course
// sets their familiarity (see recordCourseCompletion for the exact rule).
// Mapped by hand from the catalogue's titles and validated on 2026-08-20;
// a new PlanB course is invisible to the profile until someone adds it here,
// which is the safe failure: no signal rather than a wrong one.
//
// Courses deliberately absent: DEV103, DEV301, NET302 (general programming
// and networking, nothing to conclude about Bitcoin knowledge), SOC104 and
// BIZ205 (opinion and cohort material). Absence means finishing them teaches
// the profile nothing, not that they are lesser courses.
export const COURSE_CONCEPTS: Record<string, KnowledgeConcept[]> = {
  btc101: ['bitcoin-basics'],
  btc102: ['bitcoin-basics', 'keys-self-custody'],
  btc202: ['bitcoin-basics', 'privacy'],
  btc204: ['privacy', 'transactions-utxo'],
  btc208: ['bitcoin-basics'],
  btc303: ['history-philosophy', 'bitcoin-game-theory'],
  btc304: ['history-philosophy'],
  biz101: ['bitcoin-basics', 'bitcoin-economics'],
  csv402: ['scaling-covenants'],
  csv404: ['scaling-covenants', 'bitcoin-cryptography'],
  cyp201: ['keys-self-custody', 'bitcoin-cryptography'],
  cyp302: ['bitcoin-cryptography'],
  dev303: ['transactions-utxo'],
  eco104: ['bitcoin-economics', 'bitcoin-basics'],
  eco201: ['bitcoin-economics'],
  eco203: ['bitcoin-economics', 'history-philosophy'],
  eco204: ['bitcoin-economics'],
  eco205: ['bitcoin-economics'],
  eco208: ['bitcoin-economics'],
  ene101: ['mining-proof-of-work'],
  his201: ['history-philosophy'],
  his203: ['history-philosophy'],
  his204: ['history-philosophy', 'bitcoin-economics'],
  his205: ['history-philosophy', 'bitcoin-economics'],
  lnp201: ['lightning-basics', 'lightning-routing'],
  lnp202: ['lightning-basics'],
  lnp206: ['lightning-basics'],
  lnp404: ['lightning-basics'],
  min101: ['mining-proof-of-work'],
  min304: ['mining-proof-of-work'],
  min306: ['mining-proof-of-work'],
  phi101: ['history-philosophy'],
  phi203: ['history-philosophy'],
  phi305: ['history-philosophy'],
  pos305: ['keys-self-custody'],
  pro101: ['transactions-utxo', 'bitcoin-cryptography'],
  pro202: ['transactions-utxo', 'bitcoin-cryptography'],
  scr403: ['scaling-covenants'],
  scu101: ['privacy', 'keys-self-custody'],
  scu202: ['privacy', 'keys-self-custody'],
  sid202: ['sidechains'],
  sid302: ['sidechains'],
  sid402: ['sidechains'],
  sid406: ['sidechains'],
};

export function conceptsForCourse(code: string): KnowledgeConcept[] {
  return COURSE_CONCEPTS[code.toLowerCase()] ?? [];
}
