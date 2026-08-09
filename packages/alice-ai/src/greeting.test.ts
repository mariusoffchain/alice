import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GREETING_ID,
  createGreetingMessage,
  isGreeting,
  isPersistableSession,
  stripGreeting,
  toHistory,
} from './greeting.ts';

// Minimal message shape the helpers care about.
type Msg = { id: string; role: 'user' | 'assistant' | 'system'; content: string };

const greeting = (): Msg => ({ ...createGreetingMessage(), content: 'Hi!' });
const user = (content = 'What is a UTXO?'): Msg => ({ id: 'u1', role: 'user', content });
const assistant = (content = 'A UTXO is...'): Msg => ({ id: 'a1', role: 'assistant', content });
const system = (content = 'system note'): Msg => ({ id: 's1', role: 'system', content });

describe('isGreeting / createGreetingMessage', () => {
  it('recognises the greeting bubble by id', () => {
    assert.equal(isGreeting(createGreetingMessage()), true);
    assert.equal(createGreetingMessage().id, GREETING_ID);
    assert.equal(isGreeting({ id: 'u1' }), false);
  });

  it('creates the greeting empty, as chrome the animation fills in', () => {
    const m = createGreetingMessage();
    assert.equal(m.role, 'assistant');
    assert.equal(m.content, '');
  });
});

describe('stripGreeting — greeting is never saved', () => {
  it('removes the greeting and keeps everything else in order', () => {
    const msgs = [greeting(), user(), assistant()];
    assert.deepEqual(stripGreeting(msgs).map(m => m.id), ['u1', 'a1']);
  });

  it('leaves a greeting-free list untouched', () => {
    const msgs = [user(), assistant()];
    assert.deepEqual(stripGreeting(msgs), msgs);
  });

  it('drops a greeting saved by an earlier version on the way back in', () => {
    // openSession loads a legacy session that still stored the greeting.
    const loaded = [greeting(), user(), assistant()];
    assert.equal(stripGreeting(loaded).some(isGreeting), false);
  });
});

describe('isPersistableSession — no ghost session', () => {
  it('is false for an untouched New Chat (greeting only)', () => {
    assert.equal(isPersistableSession([greeting()]), false);
  });

  it('is false for an empty conversation', () => {
    assert.equal(isPersistableSession([]), false);
  });

  it('is false when only the assistant has spoken (greeting + assistant, no user)', () => {
    assert.equal(isPersistableSession([greeting(), assistant()]), false);
  });

  it('becomes true as soon as there is a real user turn', () => {
    assert.equal(isPersistableSession([greeting(), user(), assistant()]), true);
  });

  it('does not count the greeting itself as a user turn', () => {
    // The greeting is an assistant bubble; even stripped it can never satisfy
    // the user-turn requirement.
    assert.equal(isPersistableSession([greeting()]), false);
  });
});

describe('toHistory — what reaches the model', () => {
  it('drops the greeting so it is never replayed as a first assistant turn', () => {
    const history = toHistory([greeting(), user(), assistant()]);
    assert.deepEqual(history, [
      { role: 'user', content: 'What is a UTXO?' },
      { role: 'assistant', content: 'A UTXO is...' },
    ]);
  });

  it('drops system messages as well as the greeting', () => {
    const history = toHistory([system(), greeting(), user()]);
    assert.deepEqual(history, [{ role: 'user', content: 'What is a UTXO?' }]);
  });

  it('reduces each turn to role and content only', () => {
    const history = toHistory([user()]);
    assert.deepEqual(Object.keys(history[0]).sort(), ['content', 'role']);
  });

  // Regression: deleteMessage and the editMessage user path used to rebuild
  // historyRef with a bare `role === 'user' || role === 'assistant'` filter. The
  // greeting is an assistant bubble, so it survived that filter and was replayed
  // to the model as a fake first turn. Both now go through toHistory.
  it('drops the greeting even though its role passes a bare user/assistant filter', () => {
    const msgs = [greeting(), user(), assistant()];
    const naive = msgs.filter(m => m.role === 'user' || m.role === 'assistant');
    assert.equal(naive.some(isGreeting), true, 'a bare role filter keeps the greeting');

    const history = toHistory(msgs);
    assert.equal(history.length, naive.length - 1);
    assert.equal(history.some(m => m.content === 'Hi!'), false, 'greeting text must not reach the model');
  });

  it('drops the greeting when history is rebuilt from a slice (edit path)', () => {
    // editMessage rebuilds from prev.slice(0, idx); the greeting sits at index 0.
    const msgs = [greeting(), user('first'), assistant('reply'), user('second')];
    const upToSecond = toHistory(msgs.slice(0, 3));
    assert.deepEqual(upToSecond, [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
  });

  it('is idempotent on an already-stripped list (openSession path)', () => {
    const stripped = stripGreeting([greeting(), user(), assistant()]);
    assert.deepEqual(toHistory(stripped), toHistory([greeting(), user(), assistant()]));
  });
});

// The whole point: the greeting shows on a fresh chat but leaves no trace in
// any of the three sinks. This walks the same list through all of them at once.
describe('greeting is shown but never persisted, replayed, or counted', () => {
  it('holds across persistence, history, and the session guard together', () => {
    const fresh = [greeting()];
    assert.equal(isPersistableSession(fresh), false, 'greeting-only must not persist');
    assert.equal(toHistory(fresh).length, 0, 'greeting must not reach the model');
    assert.equal(stripGreeting(fresh).length, 0, 'greeting must not be saved');

    const real = [greeting(), user(), assistant()];
    assert.equal(isPersistableSession(real), true);
    assert.equal(stripGreeting(real).some(isGreeting), false);
    assert.equal(toHistory(real).some(m => (m as { id?: string }).id === GREETING_ID), false);
  });
});
