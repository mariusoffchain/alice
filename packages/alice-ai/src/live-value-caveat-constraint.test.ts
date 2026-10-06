import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRagEvaluationRuntime } from '../../../scripts/rag-eval-runtime.mjs';

// ai-system-prompt reaches the content package, so it is loaded through the
// bundling runtime like the other prompt tests.
const runtime = await loadRagEvaluationRuntime(`
  export { applyAliceResponseConstraints } from './packages/alice-ai/src/ai-system-prompt.ts';
  export { liveValueCaveat, withLiveValueCaveat } from './packages/alice-ai/src/live-value-caveat.ts';
  export { NEVER_CLAIM_CHECKS, withAnswerRuleCorrections } from './packages/alice-ai/src/answer-rules.ts';
`);

test('the one-sentence instruction keeps the live value caveat next to the sentence it qualifies', () => {
  const answer = runtime.withLiveValueCaveat('As of today the current fee rate is around 20 sat/vB. Fees change constantly.', 'en');
  const constrained = runtime.applyAliceResponseConstraints('Answer in one sentence.', answer);
  assert.ok(constrained.startsWith('As of today the current fee rate is around 20 sat/vB.'));
  assert.ok(constrained.includes(runtime.liveValueCaveat('en')));
  assert.equal(constrained.split(runtime.liveValueCaveat('en')).length, 2);
  const french = runtime.withLiveValueCaveat('En ce moment les frais sont de 15 sat/vB. Ils bougent.', 'fr');
  assert.ok(runtime.applyAliceResponseConstraints('Réponds en une phrase.', french).includes(runtime.liveValueCaveat('fr')));
  // Without a caveat the rule is unchanged.
  assert.equal(runtime.applyAliceResponseConstraints('Answer in one sentence.', 'First sentence. Second sentence.'), 'First sentence.');
});

test('the one-sentence instruction keeps an answer-rule correction next to the sentence it corrects', () => {
  const corrected = runtime.withAnswerRuleCorrections('Replacement works only if RBF was enabled when you sent it. Check your wallet.', 'en', ['replace-by-fee']);
  const correction = runtime.NEVER_CLAIM_CHECKS.find((check: { id: string }) => check.id === 'rbf-opt-in-precondition').correction.en;
  assert.ok(corrected.text.endsWith(correction));
  const constrained = runtime.applyAliceResponseConstraints('Answer in one sentence.', corrected.text);
  assert.ok(constrained.startsWith('Replacement works only if RBF was enabled when you sent it.'));
  assert.doesNotMatch(constrained, /Check your wallet/);
  assert.equal(constrained.split(correction).length, 2);
  // A live-value caveat and a correction are both kept when both apply.
  const both = runtime.withLiveValueCaveat(corrected.text + ' As of today the fee rate is 20 sat/vB.', 'en');
  const constrainedBoth = runtime.applyAliceResponseConstraints('Answer in one sentence.', both);
  assert.ok(constrainedBoth.includes(correction) && constrainedBoth.includes(runtime.liveValueCaveat('en')));
});
