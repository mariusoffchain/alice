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

test('the mobile default stays 4096 while the desktop server takes its context from the caller', async () => {
  // Mobile keeps the conservative shared default; desktop passes its own
  // roomier budget (4096 left ~250 tokens for the answer once the system
  // prompt, the retrieved context and the history were in, which truncated
  // replies mid-sentence). The Rust side must therefore accept a context size
  // rather than hardcode one, and clamp it to what llama-server can serve.
  assert.equal(LOCAL_CONTEXT_TOKENS, 4096);
  const rustPath = decodeURIComponent(new URL('../../../apps/app-desktop/src-tauri/src/lib.rs', import.meta.url).pathname);
  const rust = await readFile(rustPath, 'utf8');
  assert.match(rust, /ctx_size:\s*Option<u32>/);
  assert.match(rust, /ctx_size\.unwrap_or\(\d+\)\.clamp\(\d+,\s*\d+\)/);
  assert.match(rust, /"--ctx-size",\s*\n?\s*&?ctx/);
});
