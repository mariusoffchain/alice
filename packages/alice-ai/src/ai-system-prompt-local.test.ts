import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadRagEvaluationRuntime } from '../../../scripts/rag-eval-runtime.mjs';
import { fitMessagesToEstimatedLocalContext, LOCAL_CONTEXT_TOKENS } from './local-context-budget.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const systemPromptSource = fs.readFileSync(path.join(repoRoot, 'packages', 'alice-ai', 'src', 'ai-system-prompt.ts'), 'utf8');
const localBase = systemPromptSource.match(/const LOCAL_BITCOIN_SYSTEM_PROMPTS[\s\S]*?en: `([\s\S]*?)`,\n\s+fr:/)?.[1] ?? '';

async function prompts() {
  return loadRagEvaluationRuntime(`
    export { buildAliceSystemPrompt, buildAliceLocalSystemPrompt } from './packages/alice-ai/src/ai-system-prompt.ts';
    export { ALICE_MEMORY_PROFILE_RULES, ALICE_PAYMENT_AUTHORITY_RULES } from './packages/alice-content/src/prompts.ts';
  `);
}

test('native base instructions retain the 2000-character bound before the canonical safety addendum', () => {
  assert.ok(localBase.length > 0 && localBase.length < 2_000);
});

test('assembled native prompts preserve every canonical memory and payment rule, including custom-style replies', async () => {
  const r = await prompts();
  for (const language of ['en', 'fr']) for (const custom of ['', 'Answer in one sentence.']) {
    const native = r.buildAliceLocalSystemPrompt(custom, language);
    const desktop = r.buildAliceSystemPrompt(custom, language);
    for (const rules of [r.ALICE_MEMORY_PROFILE_RULES, r.ALICE_PAYMENT_AUTHORITY_RULES]) {
      assert.ok(native.includes(rules));
      assert.ok(desktop.includes(rules));
      for (const line of rules.split('\n')) assert.equal(native.split(line).length - 1, 1);
    }
    assert.ok(native.length < desktop.length, 'Compare assembled prompts, not source-file sizes');
    assert.match(native, /Never hide, compress, or replace payment details/);
    assert.match(native, /safe to close unless the wallet UI explicitly shows that exact/);
    assert.match(native, /Personal memory may contain only short facts explicitly stated/);
    assert.match(native, /never a source of facts or a substitute for retrieved knowledge/);
    if (custom) {
      assert.ok(native.includes(custom));
      assert.match(native, /unless it conflicts with the mandatory output language, wallet safety, privacy, or financial-advice limits/);
    }
  }
});

test('native assembly fits the unchanged estimated 4096-token budget with a full synthetic knowledge allowance', async () => {
  const r = await prompts();
  for (const language of ['en', 'fr']) {
    const messages = [
      { role: 'system' as const, content: r.buildAliceLocalSystemPrompt('', language) },
      { role: 'system' as const, content: 'Synthetic evidence. '.repeat(400).slice(0, 6000) },
      { role: 'user' as const, content: 'Explain the supplied evidence.' },
    ];
    const fit = fitMessagesToEstimatedLocalContext(messages, 768);
    assert.equal(LOCAL_CONTEXT_TOKENS, 4096);
    assert.deepEqual(fit.messages, messages);
    assert.equal(fit.responseTokens, 768);
    assert.ok(fit.promptTokens + fit.responseTokens + 64 <= LOCAL_CONTEXT_TOKENS);
  }
  // This estimates synthetic text only. Real model-tokenizer/device checks
  // remain separate; the old 2000-char base check never covered full assembly.
});

test('native prompt retains its original stronger sensitive-wallet nondisclosure instruction', async () => {
  const r = await prompts();
  assert.match(r.buildAliceLocalSystemPrompt('', 'en'), /Never ask for or expose a seed phrase, private key, balance, address history, or other sensitive wallet data/);
  assert.match(r.buildAliceLocalSystemPrompt('', 'fr'), /Ne demande et n'expose jamais une seed phrase, une clé privée, un solde, un historique d'adresses ou toute autre donnée sensible/);
});
