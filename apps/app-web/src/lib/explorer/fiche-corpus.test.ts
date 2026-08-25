import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXPLORER_FICHES,
  EXPLORER_PACK_ID,
  buildExplorerKnowledgePack,
  getFiche,
} from './fiche-corpus.ts';
import { isRecommendable, type LegalPosture } from './fiche.ts';

const POSTURES: LegalPosture[] = ['safe_to_recommend', 'educational_only', 'explain_never_recommend'];

describe('Explorer Fiche corpus', () => {
  it('every fiche is sourced and dated', () => {
    for (const f of EXPLORER_FICHES) {
      assert.ok(f.sources.length > 0, `${f.id} has at least one source`);
      for (const s of f.sources) {
        assert.match(s.url, /^https:\/\//, `${f.id} source is a URL`);
        assert.match(s.checkedAt, /^\d{4}-\d{2}-\d{2}$/, `${f.id} source is dated`);
      }
    }
  });

  it('every fiche id is unique', () => {
    const ids = EXPLORER_FICHES.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('appliesTo is a rule list, possibly empty for general-knowledge fiches', () => {
    for (const f of EXPLORER_FICHES) assert.ok(Array.isArray(f.appliesTo), `${f.id} has an appliesTo list`);
  });

  it('getFiche finds by id and misses cleanly', () => {
    assert.equal(getFiche('FICHE_ADDRESS_REUSE')?.title, 'Address reuse');
    assert.equal(getFiche('nope'), undefined);
  });

  it('every fiche has a valid posture, and non-safe ones carry a disclaimer', () => {
    for (const f of EXPLORER_FICHES) {
      assert.ok(POSTURES.includes(f.legalPosture), `${f.id} posture valid`);
      if (f.legalPosture !== 'safe_to_recommend') {
        assert.ok(f.disclaimer && f.disclaimer.length > 0, `${f.id} carries a disclaimer`);
      }
    }
  });

  it('the mixer fiche is never recommendable and flags regulatory risk', () => {
    const mixer = getFiche('FICHE_CUSTODIAL_MIXER');
    assert.ok(mixer);
    assert.equal(mixer.legalPosture, 'explain_never_recommend');
    assert.equal(isRecommendable(mixer), false);
    assert.match(mixer.disclaimer ?? '', /regulatory risk/);
    assert.equal(mixer.stability, 'volatile');
  });

  it('tool fiches about a moving landscape are volatile', () => {
    assert.equal(getFiche('FICHE_COINJOIN_LANDSCAPE')?.stability, 'volatile');
  });

  it('builds a knowledge pack whose chunks map back to fiche ids', () => {
    const pack = buildExplorerKnowledgePack();
    assert.equal(pack.id, EXPLORER_PACK_ID);
    assert.equal(pack.source, 'bundled');
    // Every fiche contributes its English source chunk; each translated fiche
    // adds one locale variant, so the pack is source + translations.
    const chunkIds = new Set(pack.chunks.map(c => c.id));
    for (const f of EXPLORER_FICHES) assert.ok(chunkIds.has(f.id), `${f.id} has a source chunk`);
    // Every fiche is translated to French, and each FR chunk shares the source
    // conceptId and maps back to its guarded fiche by stripping the locale suffix.
    const frChunks = pack.chunks.filter(c => c.locale === 'fr');
    assert.equal(frChunks.length, EXPLORER_FICHES.length, 'a French variant per fiche');
    for (const c of frChunks) {
      assert.equal(c.id, `${c.conceptId}:fr`);
      assert.ok(getFiche(c.id), `${c.id} maps back to a fiche`);
      assert.equal(c.sourceLocale, 'en');
      assert.equal(c.translationStatus, 'reviewed');
    }
    assert.equal(pack.chunks.length, EXPLORER_FICHES.length + frChunks.length);
    // Guards never cross into the retrievable pack.
    for (const c of pack.chunks) {
      assert.ok(!('legalPosture' in c));
      assert.ok(!('contraindications' in c));
    }
  });

  it('every French chunk carries real translated text, not the English source', () => {
    const pack = buildExplorerKnowledgePack();
    const byConcept = new Map(pack.chunks.filter(c => c.locale === 'en').map(c => [c.conceptId, c]));
    for (const fr of pack.chunks.filter(c => c.locale === 'fr')) {
      const en = byConcept.get(fr.conceptId);
      assert.ok(en, `${fr.id} has an English source`);
      assert.ok(fr.title.length > 0 && fr.content.length > 0);
      assert.notEqual(fr.content, en!.content, `${fr.id} is actually translated`);
    }
  });
});
