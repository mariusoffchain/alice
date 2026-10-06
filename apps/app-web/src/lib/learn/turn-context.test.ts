import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LearnChapter, LearnCoursePack } from '@alice-wallet/alice-content/src/learn-types';
import { excerptOf, pickChapter, scoreChapter, queryTokens, relevantExcerpt } from './turn-context-score.ts';

const chapter = (title: string, markdown: string): LearnChapter => ({
  chapterId: null,
  title,
  videoIds: [],
  markdown,
});

const pack = (chapters: LearnChapter[]): LearnCoursePack => ({
  code: 'btc101',
  lang: 'en',
  commit: 'deadbeef',
  name: 'The Bitcoin Journey',
  goal: '',
  objectives: [],
  assetBase: '',
  videos: {},
  intro: '',
  parts: [{ partId: null, title: 'Part', chapters }],
});

describe('pickChapter', () => {
  it('finds the chapter the question speaks to, title weighing double', () => {
    const found = pickChapter(
      'how do I back up my recovery phrase?',
      pack([
        chapter('Mining and difficulty', 'Miners order transactions into blocks.'),
        chapter('Backing up your recovery phrase', 'Write the recovery phrase down, keep it offline.'),
      ]),
    );
    assert.equal(found?.title, 'Backing up your recovery phrase');
  });

  it('returns nothing under the minimum score, instead of a random chapter', () => {
    const found = pickChapter(
      'what is the weather like today?',
      pack([chapter('Mining and difficulty', 'Miners order transactions into blocks.')]),
    );
    assert.equal(found, null);
  });

  it('matches accented French against unaccented question tokens', () => {
    const score = scoreChapter(
      ['securite'],
      chapter('La sécurité de votre portefeuille', 'La sécurité commence par la sauvegarde.'),
    );
    assert.ok(score >= 2);
  });
});

describe('excerptOf', () => {
  it('keeps short chapters whole', () => {
    assert.equal(excerptOf('Short text.', 100), 'Short text.');
  });

  it('cuts at a paragraph boundary, never mid-sentence', () => {
    const text = `${'a'.repeat(80)}\n\n${'b'.repeat(80)}\n\n${'c'.repeat(80)}`;
    const cut = excerptOf(text, 200);
    assert.ok(cut.endsWith('b'.repeat(80)));
  });
});


it('omits a single oversized paragraph rather than clipping its ending', () => {
  assert.equal(excerptOf('Claim '.repeat(50) + 'This is not guaranteed.', 100), '');
  assert.equal(excerptOf('Short opening.\n\n' + 'Claim '.repeat(50), 100), 'Short opening.');
  assert.equal(excerptOf('Text.', NaN), '');
});


it('rejects generic domain overlap and title-only claims without body evidence', () => {
  assert.equal(relevantExcerpt('Why is my Bitcoin transaction pending?', 'Bitcoin', 'An introduction to Bitcoin philosophy.'), null);
  assert.equal(relevantExcerpt('How do I back up my recovery phrase?', 'Backing up your recovery phrase', 'Welcome to this course.'), null);
  assert.equal(relevantExcerpt('Quelle différence entre un nœud complet et un nœud léger ?', 'Introduction du cours', 'Les autres choses sont moins différentes dans ce cours sur Bitcoin.'), null);
});

it('scores only the emitted prefix and ignores URL-only topic matches', () => {
  const markdown = 'A short unrelated opening.\n\n' + 'Introduction '.repeat(180) + '\n\nRecovery phrase wallet backup guidance.';
  assert.equal(relevantExcerpt('recovery phrase wallet backup', 'Recovery phrase wallet backup', markdown), null);
  assert.equal(relevantExcerpt('recovery phrase', 'Recovery phrase', '[Read here](https://example.test/recovery/phrase)\n\n![recovery phrase](asset.webp)'), null);
});

it('keeps short technical names and normalized French subjects', () => {
  assert.ok(relevantExcerpt('SPV', 'SPV verification', 'An SPV client checks block headers.'));
  assert.ok(relevantExcerpt('Les nœuds complets', 'Nœuds complets', 'Les noeuds complets vérifient les règles.'));
  assert.deepEqual(queryTokens('address reuse'), ['addres', 'reuse']);
  assert.ok(relevantExcerpt('address reuse', 'Address reuse', 'Address reuse links payments.'));
});

it('rejects adjacent topics that match only incidental terms', () => {
  assert.equal(relevantExcerpt('What changed in Taproot transactions?', 'Running a Taproot Assets Price Oracle', 'Taproot Assets price transactions and oracle setup.'), null);
  assert.equal(relevantExcerpt('recovery phrase wallet restoration', 'Mnemonic phrase dice roll', 'A recovery phrase can be generated for a wallet by rolling dice.'), null);
});


it('does not present one side as evidence for a two-subject comparison', () => {
  assert.equal(relevantExcerpt('Difference between a full node and a pruned node?', 'Installing a full node', 'The full node validates the blockchain.'), null);
  assert.ok(relevantExcerpt('Difference between a full node and a pruned node?', 'Full and pruned nodes', 'A pruned node validates the same rules as a full archival node but discards old blocks.'));
});
