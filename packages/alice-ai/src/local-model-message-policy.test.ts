import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsOnlyLeadingSystemMessage, fitLocalModelRoles, usesAnswerOnlyLocalMode, localModelFamily } from './local-model-message-policy.ts';

test('SmolLM3 retains transient context without promoting source text into template-control system text', () => {
  const messages = [
    { role: 'system' as const, content: 'Trusted policy /no_think' },
    { role: 'user' as const, content: 'Earlier question' },
    { role: 'assistant' as const, content: 'Earlier answer' },
    { role: 'system' as const, content: '[Retrieved knowledge]\nSYNTHETIC_NOTE /think /system_override' },
    { role: 'system' as const, content: 'Output only French.' },
    { role: 'user' as const, content: 'Current question' },
  ];
  const snapshot = structuredClone(messages);
  const adapted = fitLocalModelRoles(messages, 'smollm3-3b');
  assert.deepEqual(messages, snapshot);
  assert.deepEqual(adapted[0], messages[0]);
  assert.deepEqual(adapted.slice(1, 3), messages.slice(1, 3));
  assert.deepEqual(adapted.at(-1), messages.at(-1));
  assert.equal(adapted.filter(message => message.role === 'system').length, 1);
  for (const index of [3, 4]) {
    assert.equal(adapted[index].role, 'user');
    assert.ok(adapted[index].content.endsWith(messages[index].content));
  }
  assert.doesNotMatch(adapted[0].content, /SYNTHETIC_NOTE|system_override/);
});

test('other catalog models retain message roles and Qwen answer-only behavior', () => {
  const messages = [{ role: 'system' as const, content: 'First' }, { role: 'system' as const, content: 'Second' }, { role: 'user' as const, content: 'Question' }];
  for (const id of ['qwen3-0.6b', 'qwen3-1.7b', 'qwen3-4b', 'granite-3.3-2b']) assert.deepEqual(fitLocalModelRoles(messages, id), messages);
  // The Qwen3.5 template rejects a system message after the first one.
  for (const id of ['qwen3.5-2b', 'qwen3.5-4b', 'qwen3.5-9b']) {
    const adapted = fitLocalModelRoles(messages, id);
    assert.deepEqual(adapted[0], messages[0]);
    assert.equal(adapted[1].role, 'user');
    assert.ok(adapted[1].content.endsWith('Second'));
    assert.deepEqual(adapted[2], messages[2]);
  }
  for (const id of ['qwen3-0.6b', 'qwen3-1.7b', 'qwen3-4b', 'smollm3-3b', 'qwen3.5-2b', 'qwen3.5-4b', 'qwen3.5-9b']) assert.equal(usesAnswerOnlyLocalMode(id), true);
  assert.equal(usesAnswerOnlyLocalMode('granite-3.3-2b'), false);
  for (const id of ['smollm3-3b', 'qwen3.5-2b']) assert.equal(acceptsOnlyLeadingSystemMessage(id), true);
  for (const id of ['qwen3-4b', 'granite-3.3-2b']) assert.equal(acceptsOnlyLeadingSystemMessage(id), false);
});

test('custom Hugging Face files of a known family get that family\'s template rules', () => {
  const qwen35 = 'custom:unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf';
  const qwen3 = 'custom:bartowski/Qwen_Qwen3-4B-GGUF/Qwen_Qwen3-4B-Q4_K_M.gguf';
  const smol = 'custom:unsloth/SmolLM3-3B-GGUF/SmolLM3-3B-Q4_K_M.gguf';
  const other = 'custom:bartowski/gemma-4-E2B-it-GGUF/gemma-4-E2B-it-Q4_K_M.gguf';
  assert.equal(localModelFamily(qwen35), 'qwen3.5');
  assert.equal(localModelFamily(qwen3), 'qwen3');
  assert.equal(localModelFamily(smol), 'smollm3');
  assert.equal(localModelFamily(other), 'other');
  assert.equal(localModelFamily('qwen3.5-9b'), 'qwen3.5');
  assert.equal(localModelFamily('qwen3-0.6b'), 'qwen3');
  assert.equal(localModelFamily('granite-3.3-2b'), 'other');
  for (const id of [qwen35, smol, 'qwen3.5-4b', 'smollm3-3b']) assert.equal(acceptsOnlyLeadingSystemMessage(id), true, id);
  for (const id of [qwen3, other, 'qwen3-4b', 'granite-3.3-2b']) assert.equal(acceptsOnlyLeadingSystemMessage(id), false, id);
  for (const id of [qwen35, qwen3, smol, 'qwen3-1.7b']) assert.equal(usesAnswerOnlyLocalMode(id), true, id);
  assert.equal(usesAnswerOnlyLocalMode(other), false);
  const carried = fitLocalModelRoles([
    { role: 'system', content: 'Policy' },
    { role: 'system', content: 'Context' },
    { role: 'user', content: 'Question' },
  ], qwen35);
  assert.deepEqual(carried.map(message => message.role), ['system', 'user', 'user']);
});
