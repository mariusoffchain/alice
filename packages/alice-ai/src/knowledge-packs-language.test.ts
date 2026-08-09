import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAllChunks,
  preferKnowledgeLocale,
  registerPack,
  setKnowledgePackEnabled,
  unregisterPack,
  type KnowledgeChunk,
} from './knowledge-packs.ts';

const variants: KnowledgeChunk[] = [
  { id: 'ark-fr', conceptId: 'ark', locale: 'fr', sourceLocale: 'fr', translationStatus: 'source', title: 'Ark', keywords: [], level: 'beginner', content: 'Ark est un protocole.' },
  { id: 'ark-en', conceptId: 'ark', locale: 'en', sourceLocale: 'fr', translationStatus: 'reviewed', title: 'Ark', keywords: [], level: 'beginner', content: 'Ark is a protocol.' },
  { id: 'pow-fr', conceptId: 'pow', locale: 'fr', sourceLocale: 'fr', translationStatus: 'source', title: 'Proof of Work', keywords: [], level: 'beginner', content: 'La preuve de travail securise Bitcoin.' },
];

test('keeps one chunk per concept and prefers the requested locale', () => {
  const selected = preferKnowledgeLocale(variants, 'en');
  assert.deepEqual(selected.map(chunk => chunk.id), ['ark-en', 'pow-fr']);
});

test('falls back to the source locale when no translation exists', () => {
  assert.equal(preferKnowledgeLocale(variants, 'en')[1].locale, 'fr');
});

test('installed packs can stay disabled without entering the active retrieval corpus', () => {
  registerPack({
    id: 'test-disabled-pack',
    version: '1',
    language: 'en',
    source: 'downloaded',
    enabledByDefault: false,
    chunks: [{ id: 'disabled-chunk', title: 'Hidden', keywords: [], level: 'beginner', content: 'Hidden' }],
  });
  assert.equal(getAllChunks().some(chunk => chunk.id === 'disabled-chunk'), false);
  setKnowledgePackEnabled('test-disabled-pack', true);
  assert.equal(getAllChunks().some(chunk => chunk.id === 'disabled-chunk'), true);
  unregisterPack('test-disabled-pack');
});
