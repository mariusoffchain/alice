import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  courseState,
  markChapterRead,
  parseProgress,
  resumeList,
} from './progress.ts';

describe('parseProgress', () => {
  it('returns empty on invalid or missing JSON', () => {
    assert.deepEqual(parseProgress(null), {});
    assert.deepEqual(parseProgress('not json'), {});
    assert.deepEqual(parseProgress('{"btc101": {"bad": true}}'), {});
  });

  it('keeps only valid course entries', () => {
    const raw = JSON.stringify({
      btc101: { readChapters: { a: true }, lastChapterId: 'a', updatedAt: 1 },
      broken: { readChapters: null },
    });
    const parsed = parseProgress(raw);
    assert.deepEqual(Object.keys(parsed), ['btc101']);
  });
});

describe('markChapterRead / courseState', () => {
  it('walks new → started → finished', () => {
    let progress = {};
    assert.equal(courseState(progress, 'btc101', 2), 'new');
    progress = markChapterRead(progress, 'btc101', 'ch1', 10);
    assert.equal(courseState(progress, 'btc101', 2), 'started');
    progress = markChapterRead(progress, 'btc101', 'ch2', 20);
    assert.equal(courseState(progress, 'btc101', 2), 'finished');
  });

  it('is idempotent per chapter', () => {
    let progress = markChapterRead({}, 'btc101', 'ch1', 10);
    progress = markChapterRead(progress, 'btc101', 'ch1', 30);
    assert.equal(courseState(progress, 'btc101', 2), 'started');
  });
});

describe('resumeList', () => {
  it('lists started, unfinished courses, most recent first', () => {
    let progress = markChapterRead({}, 'btc101', 'ch1', 10);
    progress = markChapterRead(progress, 'cyp201', 'x', 50);
    progress = markChapterRead(progress, 'fin999', 'only', 5);
    const totals = (code: string) => ({ btc101: 24, cyp201: 10, fin999: 1 })[code] ?? 0;
    const list = resumeList(progress, totals);
    assert.deepEqual(
      list.map((r) => r.courseCode),
      ['cyp201', 'btc101'],
    );
    assert.equal(list[0].lastChapterId, 'x');
  });
});
