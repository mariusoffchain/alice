import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const temporary = mkdtempSync(path.join(tmpdir(), 'alice-synthetic-preflight-'));
let index = 0;
function rejected(syntheticKnowledge: unknown, flag: boolean, expected: RegExp, extra: string[] = []) {
  const fixture = path.join(temporary, `fixture-${index++}.json`);
  writeFileSync(fixture, JSON.stringify({ cases: [{ id: 'synthetic', question: 'What is Bitcoin?', language: 'en', history: [], mustCover: [], mustNotClaim: [], syntheticKnowledge }] }));
  const result = spawnSync(process.execPath, ['scripts/eval-rag-generation.mjs', '--fixture', fixture,
    '--output', path.join(temporary, 'never-written.json'), '--model', 'qwen3-4b',
    '--model-file', path.join(temporary, 'nonexistent-model.gguf'),
    ...(flag ? ['--synthetic-knowledge'] : []), ...extra], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, expected);
  assert.doesNotMatch(result.stderr, /ENOENT|fetch failed/, 'Validation must precede model-file/network access');
}

test('synthetic evaluation cannot silently change normal corpus runs', () => {
  rejected({ ragContext: 'Synthetic note.' }, false, /without --synthetic-knowledge/);
  rejected(undefined, true, /missing syntheticKnowledge/);
});

test('synthetic evaluation rejects invalid or excessive context before model access', () => {
  rejected({ ragContext: ' ' }, true, /nonempty string/);
  rejected({ ragContext: 'Synthetic note.', localContext: 'Unapproved field' }, true, /may only contain/);
  rejected({ ragContext: 'Synthetic note.', learnContext: 42 }, true, /null or a string/);
  rejected({ ragContext: 'a'.repeat(4000), learnContext: 'b'.repeat(2001) }, true, /exceeds the 6000-char/);
  rejected({ ragContext: 'Synthetic note.' }, true, /cannot be combined/, ['--learn-root', '/unused']);
});
