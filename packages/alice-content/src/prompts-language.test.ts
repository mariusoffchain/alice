import assert from 'node:assert/strict';
import test from 'node:test';
import { BITCOIN_SYSTEM_PROMPTS } from './prompts.ts';

test('English and French prompt variants enforce their complete output language', () => {
  assert.match(BITCOIN_SYSTEM_PROMPTS.en, /Mandatory output language: English/);
  assert.match(BITCOIN_SYSTEM_PROMPTS.fr, /Langue de sortie obligatoire : français/);
});

test('both prompt variants retain the same wallet safety policy', () => {
  for (const prompt of Object.values(BITCOIN_SYSTEM_PROMPTS)) {
    assert.match(prompt, /Never ask users to share a seed phrase/);
    assert.match(prompt, /Never claim that you signed, sent, broadcast, settled, confirmed, refunded, or cancelled a payment/);
    assert.match(prompt, /Never give recommendations to buy, sell, hold, trade, or time the market/);
  }
});
