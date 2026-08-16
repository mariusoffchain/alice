import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  disclaimerFor,
  evaluateFicheGuards,
  ficheToKnowledgeChunk,
  isRecommendable,
  type Fiche,
} from './fiche.ts';

function makeFiche(over: Partial<Fiche> = {}): Fiche {
  return {
    id: 'FICHE_TEST',
    version: 1,
    updatedAt: '2026-08-13',
    reviewedBy: 'test',
    kind: 'remediation',
    locale: 'en',
    title: 'Avoid address reuse',
    summary: 'Use a fresh address for every payment.',
    body: 'A reused address links all its payments together in public.',
    appliesTo: ['ADDRESS_REUSE'],
    retrievalHints: ['address reuse', 'fresh address'],
    preconditions: [],
    contraindications: [],
    effort: 'trivial',
    cost: 'none',
    reversibility: 'irreversible',
    legalPosture: 'safe_to_recommend',
    sources: [],
    stability: 'stable',
    ...over,
  };
}

describe('disclaimerFor', () => {
  it('returns nothing for safe_to_recommend and text otherwise', () => {
    assert.equal(disclaimerFor('safe_to_recommend'), undefined);
    assert.match(disclaimerFor('educational_only') ?? '', /not a recommendation|not as a recommendation/);
    // The mixer posture: usage may be explained on request, but the disclaimer
    // always flags the regulatory risk and that it is never a recommendation.
    const never = disclaimerFor('explain_never_recommend') ?? '';
    assert.match(never, /regulatory risk/);
    assert.match(never, /never a recommendation/);
  });
});

describe('isRecommendable', () => {
  it('only safe_to_recommend may enter an action list', () => {
    assert.equal(isRecommendable(makeFiche({ legalPosture: 'safe_to_recommend' })), true);
    assert.equal(isRecommendable(makeFiche({ legalPosture: 'educational_only' })), false);
    assert.equal(isRecommendable(makeFiche({ legalPosture: 'explain_never_recommend' })), false);
  });
});

describe('evaluateFicheGuards', () => {
  it('is eligible when preconditions hold and no hard contraindication fires', () => {
    const fiche = makeFiche({
      preconditions: [{ expr: 'utxoCount >= 2', humanLabel: 'two UTXOs' }],
      contraindications: [{ expr: 'amountBucket <= e4', humanLabel: 'too small', hard: false }],
    });
    const g = evaluateFicheGuards(fiche, expr => expr === 'utxoCount >= 2');
    assert.equal(g.applicable, true);
    assert.equal(g.dropped, false);
    assert.equal(g.eligible, true);
    assert.equal(g.reservations.length, 0);
  });

  it('a hard contraindication drops the fiche', () => {
    const fiche = makeFiche({
      contraindications: [{ expr: 'threatModel == casual_only', humanLabel: 'overkill', hard: true }],
    });
    const g = evaluateFicheGuards(fiche, () => true);
    assert.equal(g.dropped, true);
    assert.equal(g.eligible, false);
  });

  it('a soft contraindication is a reservation, not a drop', () => {
    const fiche = makeFiche({
      contraindications: [{ expr: 'amountBucket <= e4', humanLabel: 'fees may exceed gain', hard: false }],
    });
    const g = evaluateFicheGuards(fiche, () => true);
    assert.equal(g.dropped, false);
    assert.equal(g.eligible, true);
    assert.equal(g.reservations.length, 1);
  });

  it('unmet preconditions make it inapplicable, fail-closed on eval errors', () => {
    const fiche = makeFiche({ preconditions: [{ expr: 'utxoCount >= 2', humanLabel: 'two UTXOs' }] });
    const g = evaluateFicheGuards(fiche, () => { throw new Error('cannot resolve'); });
    assert.equal(g.applicable, false);
    assert.equal(g.eligible, false);
    assert.equal(g.unmetPreconditions.length, 1);
  });
});

describe('ficheToKnowledgeChunk', () => {
  it('carries the retrievable surface and reuses the id, dropping the guards', () => {
    const fiche = makeFiche();
    const chunk = ficheToKnowledgeChunk(fiche);
    assert.equal(chunk.id, 'FICHE_TEST');
    assert.equal(chunk.title, fiche.title);
    assert.ok(chunk.content.includes(fiche.summary));
    assert.ok(chunk.content.includes(fiche.body));
    assert.ok(chunk.keywords.includes('address reuse'));
    // Title words over three chars are folded into keywords for retrieval.
    assert.ok(chunk.keywords.includes('avoid'));
    // The guards never cross into the chunk.
    assert.ok(!('legalPosture' in chunk));
    assert.ok(!('contraindications' in chunk));
  });
});
