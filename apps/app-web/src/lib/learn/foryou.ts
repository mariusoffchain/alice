import type { KnowledgeConcept, PedagogicalProfile } from '@alice-wallet/alice-ai';
import { familiarityFor, KNOWLEDGE_CONCEPT_LABELS } from '@alice-wallet/alice-ai';
import type { LearnCatalogCourse } from '@alice-wallet/alice-content/src/learn-types';
import type { LearnProgress } from './progress';
import { courseState } from './progress';

// The home "For you" block, fully deterministic: Alice's existing pedagogical
// profile says which concepts the user is actively circling (chat questions,
// quiz mistakes); this maps them to the PlanB course that teaches the concept.
// Every card carries its reason. No model call anywhere.

const CONCEPT_TO_COURSE: Partial<Record<KnowledgeConcept, string>> = {
  'bitcoin-basics': 'btc101',
  'bitcoin-cryptography': 'cyp302',
  'transactions-utxo': 'btc204',
  'keys-self-custody': 'btc102',
  'mining-proof-of-work': 'min101',
  'bitcoin-economics': 'eco201',
  'bitcoin-game-theory': 'eco204',
  'lightning-basics': 'lnp201',
  'lightning-routing': 'lnp202',
  privacy: 'btc204',
  'scaling-ark': 'lnp206',
  'scaling-covenants': 'pro202',
  sidechains: 'sid202',
  'history-philosophy': 'his201',
};

export interface ForYouEntry {
  course: LearnCatalogCourse;
  concept: KnowledgeConcept;
  reason: { fr: string; en: string };
}

export function buildForYou(
  profile: PedagogicalProfile,
  progress: LearnProgress,
  courses: LearnCatalogCourse[],
  limit = 3,
): ForYouEntry[] {
  const byCode = new Map(courses.map((c) => [c.code, c]));
  const active = (Object.keys(profile.concepts) as KnowledgeConcept[])
    .map((concept) => ({ concept, state: familiarityFor(profile.concepts[concept]) }))
    // 'familiar' needs no course push; 'unseen' would make reasons dishonest.
    .filter(({ state }) => state === 'introduced' || state === 'exploring')
    .sort(
      (a, b) =>
        (profile.concepts[b.concept]?.signals ?? 0) - (profile.concepts[a.concept]?.signals ?? 0),
    );

  const entries: ForYouEntry[] = [];
  const usedCourses = new Set<string>();
  for (const { concept } of active) {
    if (entries.length >= limit) break;
    const code = CONCEPT_TO_COURSE[concept];
    if (!code || usedCourses.has(code)) continue;
    const course = byCode.get(code);
    if (!course) continue;
    // A started course already lives in the Resume block; a finished one has
    // nothing left to suggest.
    const total = Object.values(course.chapterCount)[0] ?? 0;
    if (courseState(progress, code, total) !== 'new') continue;
    usedCourses.add(code);
    const label = KNOWLEDGE_CONCEPT_LABELS[concept];
    entries.push({
      course,
      concept,
      reason: {
        fr: `Parce que tu explores « ${label} » avec Alice`,
        en: `Because you are exploring "${label}" with Alice`,
      },
    });
  }
  return entries;
}
