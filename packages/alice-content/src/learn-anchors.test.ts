import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { LEARN_CHAPTER_LINKS, anchorsForChapter, chaptersForConcept } from './learn-anchors.ts';

const REPO_ROOT = path.join(new URL('.', import.meta.url).pathname, '..', '..', '..');
const PACKS_ROOT = path.join(REPO_ROOT, 'apps', 'app-web', 'public', 'learn');
const packsPresent = fs.existsSync(PACKS_ROOT);

function chapterIdsOf(lang: string, code: string): Set<string> {
  const file = path.join(PACKS_ROOT, lang, 'courses', `${code}.json`);
  const pack = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    parts: { chapters: { chapterId: string | null }[] }[];
  };
  return new Set(
    pack.parts.flatMap((p) => p.chapters.map((c) => c.chapterId)).filter(Boolean) as string[],
  );
}

describe('learn anchor table shape', () => {
  it('has well-formed identifiers everywhere', () => {
    for (const link of LEARN_CHAPTER_LINKS) {
      assert.match(link.chapterId, /^[0-9a-f-]{36}$/, link.chapterId);
      assert.match(link.courseCode, /^[a-z]+\d*$/);
      for (const anchor of link.anchors ?? []) {
        if (anchor.type === 'block') assert.match(anchor.id, /^\d+$/);
        if (anchor.type === 'tx') assert.match(anchor.id, /^[0-9a-f]{64}$/);
        assert.ok(anchor.label.fr && anchor.label.en);
      }
      for (const concept of link.concepts ?? []) {
        assert.match(concept, /^[A-Z_]+$/);
      }
    }
  });

  it('never maps the same chapter twice', () => {
    const ids = LEARN_CHAPTER_LINKS.map((l) => l.chapterId);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('exposes lookups by chapter and by concept', () => {
    assert.ok(anchorsForChapter('b7561082-8943-519d-95d1-a5f60dd2686d').length >= 1);
    assert.equal(anchorsForChapter('inconnu').length, 0);
    assert.ok(chaptersForConcept('ADDRESS_REUSE').length >= 1);
    assert.equal(chaptersForConcept('RIEN').length, 0);
  });
});

describe('learn anchor table against generated packs', { skip: !packsPresent }, () => {
  it('references only chapterIds that exist in both embedded languages', () => {
    const cache = new Map<string, Set<string>>();
    for (const link of LEARN_CHAPTER_LINKS) {
      for (const lang of ['fr', 'en']) {
        const key = `${lang}/${link.courseCode}`;
        if (!cache.has(key)) cache.set(key, chapterIdsOf(lang, link.courseCode));
        assert.ok(
          cache.get(key)!.has(link.chapterId),
          `${link.chapterId} absent de ${key}`,
        );
      }
    }
  });
});
