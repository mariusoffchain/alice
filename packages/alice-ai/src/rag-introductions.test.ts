import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ragSource = fs.readFileSync(path.join(import.meta.dirname, 'rag.ts'), 'utf8');

const INTRODUCTIONS = [
  'utxo-introduction',
  'utxo-management-introduction',
  'coinjoin-introduction',
  'payjoin-introduction',
  'proof-of-work-introduction',
  'lightning-introduction',
  'multisig-introduction',
  'miniscript-introduction',
  'ark-introduction',
  'vtxo-introduction',
  'l402-introduction',
];

test('broad Bitcoin concepts keep a dedicated beginner introduction', () => {
  for (const id of INTRODUCTIONS) {
    assert.match(ragSource, new RegExp(`id: '${id}'[\\s\\S]{0,600}level: 'beginner'`));
  }
});

test('definition retrieval prefers a directly matched beginner note', () => {
  assert.match(ragSource, /isDefinitionQuestion\(normalizedQuery\)/);
  assert.match(ragSource, /chunk\.level === 'beginner' && hasDirectMatch\(chunk, normalizedQuery\)/);
});
