import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildQuizAsk, buildSelectionAsk, consumeLearnAsk, requestLearnAsk } from './ask.ts';

describe('buildQuizAsk', () => {
  it('carries question, picked wrong answer and correct answer in the context', () => {
    const ask = buildQuizAsk('fr', 'btc101', 'Quand a eu lieu le halving ?', 'En 2013', 'En 2012');
    assert.equal(ask.label, 'QUIZ BTC101');
    assert.match(ask.text, /Quand a eu lieu le halving \?/);
    assert.match(ask.text, /En 2013/);
    assert.match(ask.text, /En 2012/);
    assert.match(ask.draft, /tentante mais fausse/);
  });

  it('clips oversized fields', () => {
    const long = 'x'.repeat(600);
    const ask = buildQuizAsk('en', 'btc101', long, long, long);
    assert.ok(ask.text.length < 700, `${ask.text.length}`);
    assert.match(ask.draft, /tempting but wrong/);
  });
});

describe('buildSelectionAsk', () => {
  it('quotes the passage in the reading language and prefills a draft', () => {
    const ask = buildSelectionAsk('fr', 'btc204', 'La réutilisation d’adresse', 'Un  passage\navec des espaces');
    assert.match(ask.text, /Un passage avec des espaces/);
    assert.match(ask.label, /BTC204/);
    assert.match(ask.draft, /explique-le moi simplement/);
  });
});

describe('requestLearnAsk / consumeLearnAsk', () => {
  it('hands the request over exactly once', () => {
    const request = buildQuizAsk('fr', 'btc101', 'Q ?', 'faux', 'vrai');
    requestLearnAsk(request);
    assert.deepEqual(consumeLearnAsk(), request);
    assert.equal(consumeLearnAsk(), null);
  });
});
