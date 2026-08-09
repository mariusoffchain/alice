import assert from 'node:assert/strict';
import test from 'node:test';
import { ragContextChunkLimit } from './rag-context-budget.ts';

test('local RAG keeps beginner prompts to one note', () => {
  assert.equal(ragContextChunkLimit(true, false), 1);
});

test('local RAG permits a second note for technical questions', () => {
  assert.equal(ragContextChunkLimit(true, true), 2);
});

test('Private Cloud keeps the full three-note RAG context', () => {
  assert.equal(ragContextChunkLimit(false, false), 3);
  assert.equal(ragContextChunkLimit(false, true), 3);
});
