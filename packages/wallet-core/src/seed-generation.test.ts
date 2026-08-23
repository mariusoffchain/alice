import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedGenerationTracker } from './seed-generation.ts';

test('a backend bound to the current seed is not stale', () => {
  const tracker = createSeedGenerationTracker();
  tracker.bump();
  tracker.bind();
  assert.equal(tracker.stale(), false);
});

test('import A then create B: the backend built for A is stale once B is saved', () => {
  const tracker = createSeedGenerationTracker();
  tracker.bump(); // seed A saved
  tracker.bind(); // backend built for A
  tracker.bump(); // seed B saved over it
  assert.equal(tracker.stale(), true, 'the A backend must not be reused for B');
  tracker.bind(); // a new backend built for B
  assert.equal(tracker.stale(), false);
});

test('nothing bound is always stale', () => {
  const tracker = createSeedGenerationTracker();
  assert.equal(tracker.stale(), true);
  tracker.bind();
  tracker.unbind();
  assert.equal(tracker.stale(), true);
});

// The race itself (an initialisation for A resolving after B) is covered in
// backend-slot.test.ts against the real slot logic.
