import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LearnChapter, LearnCoursePack } from '@alice-wallet/alice-content/src/learn-types';
import { excerptOf, pickChapter, scoreChapter } from './turn-context-score.ts';

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
        chapter('Backing up your recovery phrase', 'Write the words down, keep them offline.'),
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
