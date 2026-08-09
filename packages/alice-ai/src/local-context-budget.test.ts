import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  fitMessagesToEstimatedLocalContext,
  LOCAL_CONTEXT_TOKENS,
} from './local-context-budget.ts';

test('desktop context trimming preserves the system message and latest user turn', () => {
  const result = fitMessagesToEstimatedLocalContext([
    { role: 'system', content: 'Alice system prompt' },
    { role: 'user', content: 'old question '.repeat(900) },
    { role: 'assistant', content: 'old answer '.repeat(900) },
    { role: 'user', content: 'current question' },
  ], 768);

  assert.equal(result.messages[0]?.role, 'system');
  assert.equal(result.messages.at(-1)?.content, 'current question');
  assert.equal(result.messages.some(message => message.content.startsWith('old question')), false);
  assert.ok(result.responseTokens >= 128);
});

test('native and desktop llama runtimes use the shared 4096-token budget', async () => {
  assert.equal(LOCAL_CONTEXT_TOKENS, 4096);
  const rustPath = decodeURIComponent(new URL('../../../apps/app-desktop/src-tauri/src/lib.rs', import.meta.url).pathname);
  const rust = await readFile(rustPath, 'utf8');
  assert.match(rust, /"--ctx-size",\s*"4096"/);
});
