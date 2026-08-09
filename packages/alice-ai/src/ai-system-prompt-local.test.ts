import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const systemPromptSource = fs.readFileSync(
  path.join(repoRoot, 'packages', 'alice-ai', 'src', 'ai-system-prompt.ts'),
  'utf8',
);
const cloudPromptSource = fs.readFileSync(
  path.join(repoRoot, 'packages', 'alice-content', 'src', 'prompts.ts'),
  'utf8',
);
const localPrompt = systemPromptSource.match(
  /const LOCAL_BITCOIN_SYSTEM_PROMPTS[\s\S]*?en: `([\s\S]*?)`,\n\s+fr:/,
)?.[1] ?? '';

test('local prompt stays compact enough for an on-device model', () => {
  assert.ok(localPrompt.length < 2_000);
  assert.ok(localPrompt.length < cloudPromptSource.length / 2);
});

test('local prompt keeps the critical wallet safety boundaries', () => {
  const prompt = localPrompt.toLowerCase();

  assert.match(prompt, /seed phrase/);
  assert.match(prompt, /private key/);
  assert.match(prompt, /wallet code/);
  assert.match(prompt, /never claim that you performed or confirmed a payment/);
  assert.match(prompt, /not a financial or investment advisor/);
});

test('local prompt preserves custom response instructions', () => {
  assert.match(systemPromptSource, /Priority user instruction for response style and format: \$\{custom\}/);
  assert.match(systemPromptSource, /unless it conflicts with the mandatory output language, wallet safety/);
});
