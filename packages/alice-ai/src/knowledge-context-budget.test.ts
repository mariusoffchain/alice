import assert from 'node:assert/strict';
import test from 'node:test';
import { fitKnowledgeContext, knowledgeContextCharLimit } from './knowledge-context-budget.ts';

test('local backend gets the compact 6000 char limit', () => {
  assert.equal(knowledgeContextCharLimit(true), 6000);
});

test('cloud backend gets the full 12000 char limit', () => {
  assert.equal(knowledgeContextCharLimit(false), 12000);
});

test('hard cap: header + chunk fills budget exactly, leaving nothing for Learn', () => {
  const header = 'HDR';
  const chunkText = '0123456789';
  const maxChars = header.length + 2 + chunkText.length; // 15, exact fit for one chunk

  const result = fitKnowledgeContext({
    header,
    chunks: [{ id: 'a', text: chunkText }],
    learn: { label: 'LBL', excerpt: 'anything that would need room' },
    maxChars,
  });

  assert.equal(result.ragContext, `${header}\n\n${chunkText}`);
  assert.equal(result.ragContext!.length, maxChars);
  assert.equal((result.ragContext?.length ?? 0) + (result.learnContext?.length ?? 0), maxChars);
  assert.equal(result.learnContext, null);
});

test('hard cap: label + paragraph fills remaining Learn budget exactly', () => {
  const label = 'LBL';
  const paragraph = '123456789012345'; // 15 chars
  const maxChars = label.length + 1 + paragraph.length; // 19

  const result = fitKnowledgeContext({
    header: 'H',
    chunks: [],
    learn: { label, excerpt: paragraph },
    maxChars,
  });

  assert.equal(result.ragContext, null);
  assert.equal(result.learnContext, `${label}\n${paragraph}`);
  assert.equal(result.learnContext!.length, maxChars);
});

test('whole evidence preservation: a caveat sentence is kept whole, never truncated', () => {
  const header = 'H';
  const chunkText =
    'The fee is flat. Note: this does not apply during maintenance windows, which vary by region.';
  const exactFit = header.length + 2 + chunkText.length;

  const fits = fitKnowledgeContext({
    header,
    chunks: [{ id: 'a', text: chunkText }],
    learn: null,
    maxChars: exactFit,
  });
  assert.equal(fits.ragContext, `${header}\n\n${chunkText}`);
  assert.deepEqual(fits.selectedIds, ['a']);

  const oneShort = fitKnowledgeContext({
    header,
    chunks: [{ id: 'a', text: chunkText }],
    learn: null,
    maxChars: exactFit - 1,
  });
  assert.equal(oneShort.ragContext, null);
  assert.deepEqual(oneShort.selectedIds, []);
  assert.deepEqual(oneShort.omittedIds, ['a']);
});

test('order and selectedIds reflect only chunks actually emitted, in original order', () => {
  const header = 'H';
  const small = 'short';
  const oversized = 'x'.repeat(1000);
  const maxChars = header.length + 2 + small.length + 2 + small.length; // room for two small chunks only

  const result = fitKnowledgeContext({
    header,
    chunks: [
      { id: 'a', text: small },
      { id: 'b', text: oversized },
      { id: 'c', text: 'other' },
    ],
    learn: null,
    maxChars,
  });

  assert.deepEqual(result.selectedIds, ['a', 'c']);
  assert.ok(result.omittedIds.includes('b'));
  assert.equal(result.ragContext, `${header}\n\n${small}\n\nother`);
});

test('invalid budgets fail closed to empty output', () => {
  const chunks = [{ id: 'a', text: 'some text' }];

  for (const maxChars of [NaN, Infinity, -Infinity, -5]) {
    const result = fitKnowledgeContext({
      header: 'H',
      chunks,
      learn: { label: 'L', excerpt: 'excerpt' },
      maxChars,
    });
    assert.equal(result.ragContext, null, `maxChars=${maxChars}`);
    assert.equal(result.learnContext, null, `maxChars=${maxChars}`);
    assert.deepEqual(result.selectedIds, [], `maxChars=${maxChars}`);
    assert.equal(result.duplicateLearnParagraphs, 0, `maxChars=${maxChars}`);
  }
});

test('exact duplicate Learn paragraph is removed; a negated variant is retained', () => {
  const header = 'H';
  const chunkText =
    'The protocol charges a flat fee of ten cents per transaction regardless of network congestion.';
  const duplicateParagraph = chunkText;
  const negatedParagraph =
    'The protocol does not charge a flat fee of ten cents per transaction regardless of network congestion.';
  const excerpt = `${duplicateParagraph}\n\n${negatedParagraph}`;

  const result = fitKnowledgeContext({
    header,
    chunks: [{ id: 'a', text: chunkText }],
    learn: { label: 'Learn', excerpt },
    maxChars: 12000,
  });

  assert.equal(result.duplicateLearnParagraphs, 1);
  assert.ok(result.learnContext);
  assert.ok(result.learnContext!.includes(negatedParagraph));
  assert.equal(result.learnContext!.split('\n\n').filter((p) => p === duplicateParagraph).length, 0);
});

test('no blank context: empty inputs produce null contexts, not empty strings', () => {
  const result = fitKnowledgeContext({
    header: 'H',
    chunks: [],
    learn: null,
    maxChars: 100,
  });

  assert.equal(result.ragContext, null);
  assert.equal(result.learnContext, null);
  assert.deepEqual(result.selectedIds, []);
  assert.deepEqual(result.omittedIds, []);
  assert.equal(result.duplicateLearnParagraphs, 0);
});

test('oversized first chunk is skipped while a later chunk that fits is still selected', () => {
  const header = 'H';
  const oversizedFirst = 'y'.repeat(2000);
  const second = 'fits fine';
  const maxChars = header.length + 2 + second.length;

  const result = fitKnowledgeContext({
    header,
    chunks: [
      { id: 'first', text: oversizedFirst },
      { id: 'second', text: second },
    ],
    learn: null,
    maxChars,
  });

  assert.deepEqual(result.selectedIds, ['second']);
  assert.ok(result.omittedIds.includes('first'));
  assert.equal(result.ragContext, `${header}\n\n${second}`);
});

test('unicode edge: label truncation never splits a surrogate pair', () => {
  const label = 'A'.repeat(239) + '\u{1F600}'; // 239 + 2 UTF-16 units = 241 chars
  const result = fitKnowledgeContext({
    header: 'H',
    chunks: [],
    learn: { label, excerpt: 'short excerpt text' },
    maxChars: 12000,
  });

  assert.ok(result.learnContext);
  const emittedLabel = result.learnContext!.split('\n')[0];
  assert.equal(emittedLabel, 'A'.repeat(239));
  for (let i = 0; i < emittedLabel.length; i += 1) {
    const code = emittedLabel.charCodeAt(i);
    assert.ok(code < 0xd800 || code > 0xdfff, 'no lone surrogate in emitted label');
  }
});

test('unicode edge: case-insensitive dedup works across accented and emoji text', () => {
  const header = 'H';
  const chunkA = 'Café ÑOÑO \u{1F600} note';
  const chunkB = 'CAFÉ ñoño \u{1F600} NOTE';

  const result = fitKnowledgeContext({
    header,
    chunks: [
      { id: 'a', text: chunkA },
      { id: 'b', text: chunkB },
    ],
    learn: null,
    maxChars: 12000,
  });

  assert.deepEqual(result.selectedIds, ['a']);
  assert.ok(result.omittedIds.includes('b'));
});


test('bounded scans never expose the cut prefix of a huge Learn paragraph', () => {
  const result = fitKnowledgeContext({header: 'H', chunks: [], maxChars: 12000,
    learn: {label: 'Course', excerpt: 'a'.repeat(11900) + ' '.repeat(500) + 'NOT SAFE.'}});
  assert.equal(result.learnContext, null);
});

test('empty text and missing Learn attribution are not injected', () => {
  const result = fitKnowledgeContext({header: 'H', chunks: [{id:'blank', text:'  '}],
    maxChars:12000, learn:{label:' ',excerpt:'Unattributed paragraph.'}});
  assert.equal(result.ragContext, null);
  assert.equal(result.learnContext, null);
});
