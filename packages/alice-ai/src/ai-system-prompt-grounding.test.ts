import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRagEvaluationRuntime } from '../../../scripts/rag-eval-runtime.mjs';

async function loadPromptModule() {
  return loadRagEvaluationRuntime(`
    export { buildAliceSystemPrompt, buildAliceLocalSystemPrompt, withAliceInstructionReminder } from './packages/alice-ai/src/ai-system-prompt.ts';
  `, {});
}

test('buildAliceSystemPrompt keeps the underlying Bitcoin system prompt byte-for-byte when custom instructions are added', async () => {
  const { buildAliceSystemPrompt } = await loadPromptModule();
  for (const language of ['en', 'fr']) {
    const base = buildAliceSystemPrompt('', language);
    const withCustom = buildAliceSystemPrompt('Reply with a synthetic test tone.', language);

    assert.ok(withCustom.endsWith(base));
    assert.match(withCustom, /unless they conflict with wallet safety, privacy, or financial-advice limits/);
  }
});

test('buildAliceLocalSystemPrompt retains wallet, privacy, and financial-advice boundaries with and without custom instructions', async () => {
  const { buildAliceLocalSystemPrompt } = await loadPromptModule();
  for (const custom of ['', 'Reply with a synthetic test tone.']) {
    for (const language of ['en', 'fr']) {
      const prompt = buildAliceLocalSystemPrompt(custom, language).toLowerCase();
      assert.match(prompt, /seed phrase/);
      assert.match(prompt, language === 'fr' ? /cl[ée] priv[ée]e/ : /private key/);
      assert.match(prompt, language === 'fr' ? /jamais.*effectu[ée] ou confirm[ée] un paiement/ : /never claim that you performed or confirmed a payment/);
      assert.match(prompt, language === 'fr' ? /conseill[èe]re financi[èe]re/ : /not a financial or investment advisor/);
    }
  }
});
