import assert from 'node:assert/strict';
import test from 'node:test';
import { learnContextFor, registerLearnContextProvider } from './learn-context.ts';

test('surfaces without Learn do not add course context', async () => {
  assert.equal(await learnContextFor('Bitcoin'), null);
});

test('Learn receives the resolved response language and keeps its size bound', async () => {
  registerLearnContextProvider(async (query, options) => {
    assert.equal(query, 'Comment sauvegarder ma phrase de récupération ?');
    assert.equal(options?.targetLanguage, 'fr');
    return { label: 'Recovery', excerpt: `${'x'.repeat(900)}\n\n${'y'.repeat(1_300)}` };
  });
  const result = await learnContextFor('Comment sauvegarder ma phrase de récupération ?', { targetLanguage: 'fr' });
  assert.equal(result?.excerpt, 'x'.repeat(900));
});

test('missing, blank or failed Learn context does not fail retrieval', async () => {
  for (const provider of [
    async () => null,
    async () => ({ label: 'Empty', excerpt: '  ' }),
    async () => { throw new Error('Pack unavailable'); },
  ]) {
    registerLearnContextProvider(provider);
    assert.equal(await learnContextFor('Bitcoin'), null);
  }
});

test('a slow Learn provider remains bounded and a late answer is ignored', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (value: { label: string; excerpt: string }) => void;
  registerLearnContextProvider(() => new Promise(resolve => { finish = resolve; }));
  const result = learnContextFor('Bitcoin');
  t.mock.timers.tick(1_500);
  assert.equal(await result, null);
  finish({ label: 'Late', excerpt: 'Too late for this turn.' });
});


test('an oversized single Learn paragraph is omitted instead of losing its qualifier', async () => {
  registerLearnContextProvider(async () => ({ label: 'Safety', excerpt: `${'Claim '.repeat(400)}Only if all required conditions hold.` }));
  assert.equal(await learnContextFor('Bitcoin'), null);
});
