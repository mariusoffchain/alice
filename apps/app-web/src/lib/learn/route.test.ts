import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { learnViewToSearch, parseLearnView } from './route.ts';
import type { LearnView } from './route.ts';

describe('parseLearnView / learnViewToSearch', () => {
  const cases: LearnView[] = [
    { kind: 'home' },
    { kind: 'course', code: 'btc101' },
    { kind: 'chapter', code: 'btc101', chapterId: '27e3fb60-4b50-556b-9e70-c4f5475c121d' },
    { kind: 'quiz', code: 'btc101', partId: '3cd2ac82-026c-53e1-874a-baf5842adc6d' },
    { kind: 'tutorial', category: 'privacy', slug: 'ashigaru-whirlpool' },
  ];

  it('round-trips every view kind', () => {
    for (const view of cases) {
      assert.deepEqual(parseLearnView(learnViewToSearch(view)), view);
    }
  });

  it('falls back to home on garbage', () => {
    assert.deepEqual(parseLearnView('?tutorial=broken'), { kind: 'home' });
    assert.deepEqual(parseLearnView('?chapter=x'), { kind: 'home' });
    assert.deepEqual(parseLearnView(''), { kind: 'home' });
  });
});
