import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { questionsForChapters, shuffledChoices } from './quiz.ts';
import type { LearnQuizQuestion } from '@alice-wallet/alice-content/src/learn-types';

const question = (id: string, chapterId: string, reviewed = true): LearnQuizQuestion => ({
  id,
  chapterId,
  difficulty: 'easy',
  question: 'Q?',
  answer: 'bonne',
  wrongAnswers: ['m1', 'm2', 'm3'],
  explanation: 'parce que',
  reviewed,
});

describe('shuffledChoices', () => {
  it('is deterministic for a given question id', () => {
    const q = question('abc', 'ch1');
    assert.deepEqual(shuffledChoices(q), shuffledChoices(q));
  });

  it('keeps exactly one correct choice among all answers', () => {
    const choices = shuffledChoices(question('xyz', 'ch1'));
    assert.equal(choices.length, 4);
    assert.equal(choices.filter((c) => c.correct).length, 1);
    assert.deepEqual(new Set(choices.map((c) => c.text)), new Set(['bonne', 'm1', 'm2', 'm3']));
  });
});

describe('questionsForChapters', () => {
  it('filters by chapter and puts reviewed questions first', () => {
    const all = [
      question('a', 'ch1', false),
      question('b', 'ch1', true),
      question('c', 'ch2', true),
    ];
    const picked = questionsForChapters(all, ['ch1', null], 10);
    assert.deepEqual(
      picked.map((q) => q.id),
      ['b', 'a'],
    );
  });

  it('respects the limit', () => {
    const all = [question('a', 'ch1'), question('b', 'ch1'), question('c', 'ch1')];
    assert.equal(questionsForChapters(all, ['ch1'], 2).length, 2);
  });
});
