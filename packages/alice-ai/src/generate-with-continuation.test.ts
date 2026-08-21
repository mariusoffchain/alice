import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONTINUE_INSTRUCTION,
  CONTINUE_INSTRUCTIONS,
  MAX_AUTO_CONTINUATIONS,
  generateWithContinuation,
} from './generate-with-continuation.ts';
import type { AIBackend, AIResponse, AIBackendStatus } from './ai-backend';
import type { Message } from './llm';
import type { PartMessage } from './message-parts';

// One scripted reply per round. `sendMessage` streams `content` chunk by chunk
// (so the streaming path is exercised), records the messages it was handed, and
// returns the rest of the shape as given.
type Round = Partial<AIResponse> & { content: string; throws?: Error };

function fakeBackend(rounds: Round[]) {
  const calls: { messages: PartMessage[] }[] = [];
  let round = 0;
  const backend: AIBackend = {
    type: 'cloud',
    init: async () => {},
    status: (): AIBackendStatus => ({ state: 'ready' }),
    dispose: async () => {},
    async sendMessage(messages, onChunk, options) {
      const current = rounds[round] ?? { content: '' };
      round += 1;
      calls.push({ messages: messages.map(m => ({ ...m })) });
      if (current.throws) throw current.throws;
      if (onChunk && current.content) {
        for (const ch of current.content) onChunk(ch);
      }
      return {
        content: current.content,
        usage: current.usage,
        durationMs: current.durationMs,
        truncated: current.truncated,
      };
    },
  };
  return { backend, calls, callCount: () => round };
}

const history: Message[] = [{ role: 'user', content: 'Explain UTXOs.' }];

async function run(rounds: Round[], allowContinuation = true) {
  const { backend, calls, callCount } = fakeBackend(rounds);
  const texts: string[] = [];
  const outcome = await generateWithContinuation(
    backend, history, allowContinuation, t => texts.push(t),
  );
  return { outcome, calls, callCount: callCount(), texts };
}

describe('generateWithContinuation', () => {
  it('does not continue when the first answer is not truncated', async () => {
    const { outcome, callCount } = await run([
      { content: 'A complete answer.', truncated: false },
    ]);
    assert.equal(callCount, 1);
    assert.equal(outcome.text, 'A complete answer.');
    assert.equal(outcome.truncated, false);
  });

  it('continues exactly once when the first answer is truncated', async () => {
    const { outcome, calls, callCount } = await run([
      { content: 'First half ', truncated: true },
      { content: 'second half.', truncated: false },
    ]);
    assert.equal(callCount, 2);
    assert.equal(outcome.text, 'First half second half.');
    assert.equal(outcome.truncated, false);
    // The continuation round is fed the partial answer plus the continue nudge.
    const second = calls[1].messages;
    assert.deepEqual(second[second.length - 2], { role: 'assistant', content: 'First half ' });
    assert.deepEqual(second[second.length - 1], { role: 'user', content: CONTINUE_INSTRUCTION });
  });

  it('never continues more than once, even if still truncated', async () => {
    // Three rounds scripted, all truncated; the cap must stop at 2 calls and
    // report the answer as still truncated.
    const { outcome, callCount } = await run([
      { content: 'one ', truncated: true },
      { content: 'two ', truncated: true },
      { content: 'three ', truncated: true },
    ]);
    assert.equal(callCount, 1 + MAX_AUTO_CONTINUATIONS);
    assert.equal(callCount, 2);
    assert.equal(outcome.text, 'one two ');
    assert.equal(outcome.truncated, true);
  });

  it('does not continue when allowContinuation is false', async () => {
    const { outcome, callCount } = await run(
      [{ content: 'Just one sentence.', truncated: true }],
      false,
    );
    assert.equal(callCount, 1);
    assert.equal(outcome.text, 'Just one sentence.');
    // The caller asked to suppress continuation, but the answer really was cut,
    // so the flag stays true, that is what drives the "may be incomplete" note.
    assert.equal(outcome.truncated, true);
  });

  it('lets a round-0 failure propagate to the caller', async () => {
    const boom = new Error('network down');
    const { backend } = fakeBackend([{ content: '', throws: boom }]);
    await assert.rejects(
      () => generateWithContinuation(backend, history, true, () => {}),
      /network down/,
    );
  });

  it('keeps the partial answer when a continuation round fails', async () => {
    const { outcome, callCount } = await run([
      { content: 'Partial answer paid for. ', truncated: true, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { content: '', throws: new Error('drop on continuation') },
    ]);
    assert.equal(callCount, 2);
    assert.equal(outcome.text, 'Partial answer paid for. ');
    assert.equal(outcome.truncated, true);
    // Usage accrued before the failure is preserved, not lost.
    assert.deepEqual(outcome.usage, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('stops when a continuation round returns an empty segment', async () => {
    const { outcome, callCount } = await run([
      { content: 'Has content ', truncated: true },
      { content: '', truncated: true },
    ]);
    assert.equal(callCount, 2);
    assert.equal(outcome.text, 'Has content ');
    // Still truncated: the segment added nothing, so we stop rather than loop.
    assert.equal(outcome.truncated, true);
  });

  it('does not continue when the first round is truncated but blank', async () => {
    // A reasoning model can burn the whole budget before writing a word. There
    // is nothing to extend, so no second call is made.
    const { outcome, callCount } = await run([
      { content: '', truncated: true },
    ]);
    assert.equal(callCount, 1);
    assert.equal(outcome.text, '');
    assert.equal(outcome.truncated, true);
  });

  it('sums token usage across rounds', async () => {
    const { outcome } = await run([
      { content: 'aaa ', truncated: true, usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 }, durationMs: 200 },
      { content: 'bbb', truncated: false, usage: { promptTokens: 150, completionTokens: 30, totalTokens: 180 }, durationMs: 120 },
    ]);
    assert.deepEqual(outcome.usage, { promptTokens: 250, completionTokens: 70, totalTokens: 320 });
    assert.equal(outcome.durationMs, 320);
  });

  it('leaves usage undefined when no round reported any', async () => {
    const { outcome } = await run([{ content: 'no usage', truncated: false }]);
    assert.equal(outcome.usage, undefined);
    assert.equal(outcome.durationMs, undefined);
  });

  it('falls back to streamed text when content is empty but chunks arrived', async () => {
    // Some backends stream deltas and return an empty `content`; the streamed
    // text must not be lost.
    const { backend } = fakeBackend([]);
    const streaming: AIBackend = {
      ...backend,
      async sendMessage(_messages, onChunk) {
        onChunk?.('streamed only');
        return { content: '', truncated: false };
      },
    };
    const outcome = await generateWithContinuation(streaming, history, true, () => {});
    assert.equal(outcome.text, 'streamed only');
  });
});

it('uses the localized continuation instruction for a French answer', async () => {
  const { backend, calls } = fakeBackend([
    { content: 'Une premiere partie', truncated: true },
    { content: ' puis la conclusion.', truncated: false },
  ]);

  await generateWithContinuation(backend, [{ role: 'user', content: 'Explique Bitcoin.' }], true, () => {}, {
    responseLanguage: 'fr',
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].messages.at(-1), { role: 'user', content: CONTINUE_INSTRUCTIONS.fr });
});
