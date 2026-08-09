import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dotProduct,
  rankBySimilarity,
  reciprocalRankFusion,
  toPassageText,
  toQueryText,
  type ChunkEmbeddingIndex,
} from './semantic-search.ts';

test('toQueryText and toPassageText apply the e5 prefix convention', () => {
  assert.equal(toQueryText('what is bitcoin'), 'query: what is bitcoin');
  assert.equal(toPassageText('Bitcoin', 'A decentralized network.'), 'passage: Bitcoin. A decentralized network.');
});

test('dotProduct sums the elementwise product over the given row', () => {
  const flat = new Float32Array([1, 0, 0, 0, 1, 0]); // two rows of dim 3
  assert.equal(dotProduct(new Float32Array([1, 0, 0]), flat, 0, 3), 1);
  assert.equal(dotProduct(new Float32Array([1, 0, 0]), flat, 3, 3), 0);
  assert.equal(dotProduct(new Float32Array([0, 1, 0]), flat, 3, 3), 1);
});

function buildIndex(vectorsById: Record<string, number[]>): ChunkEmbeddingIndex {
  const ids = Object.keys(vectorsById);
  const dim = vectorsById[ids[0]].length;
  const vectors = new Float32Array(ids.length * dim);
  ids.forEach((id, row) => vectors.set(vectorsById[id], row * dim));
  return { dim, ids, vectors };
}

test('rankBySimilarity returns the closest vectors first', () => {
  const index = buildIndex({
    'exact-match': [1, 0],
    orthogonal: [0, 1],
    opposite: [-1, 0],
    close: [0.9, 0.1],
  });
  const query = new Float32Array([1, 0]);

  const ranked = rankBySimilarity(query, index, 3);

  assert.deepEqual(ranked.map(r => r.id), ['exact-match', 'close', 'orthogonal']);
  assert.equal(ranked[0].score, 1);
});

test('rankBySimilarity respects topK', () => {
  const index = buildIndex({ a: [1, 0], b: [0.9, 0.1], c: [0.5, 0.5], d: [0, 1] });
  const ranked = rankBySimilarity(new Float32Array([1, 0]), index, 2);
  assert.equal(ranked.length, 2);
});

test('reciprocalRankFusion favors a chunk ranked well in both lists', () => {
  const lexical = ['b', 'a', 'c'];
  const semantic = ['a', 'b', 'd'];

  const fused = reciprocalRankFusion([lexical, semantic]);

  // 'a' is #2 lexical / #1 semantic, 'b' is #1 lexical / #2 semantic —
  // close, but 'a' benefiting from the better semantic rank should not
  // rank behind chunks appearing in only one list.
  assert.ok(fused[0].id === 'a' || fused[0].id === 'b');
  assert.ok(fused.map(f => f.id).indexOf('a') <= 1);
  assert.ok(fused.map(f => f.id).indexOf('b') <= 1);
});

test('reciprocalRankFusion still surfaces a chunk found in only one ranking', () => {
  const fused = reciprocalRankFusion([['only-lexical'], ['only-semantic']]);
  const ids = fused.map(f => f.id);
  assert.ok(ids.includes('only-lexical'));
  assert.ok(ids.includes('only-semantic'));
});

test('reciprocalRankFusion ranks a top-of-one-list chunk above one absent everywhere obvious', () => {
  const fused = reciprocalRankFusion([['top'], []]);
  assert.equal(fused[0].id, 'top');
});
