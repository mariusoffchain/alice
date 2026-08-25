import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { annotateAnchors, normalizeLinkHref, parseInline, parseMarkdown, resolveAssetUrl } from './markdown.ts';

describe('parseInline', () => {
  it('parses bold, italic, code and links', () => {
    const nodes = parseInline('Un **mot** en *italique* avec `du code` et un [lien](https://x.tld/a)');
    assert.deepEqual(nodes, [
      { kind: 'text', text: 'Un ' },
      { kind: 'bold', text: 'mot' },
      { kind: 'text', text: ' en ' },
      { kind: 'italic', text: 'italique' },
      { kind: 'text', text: ' avec ' },
      { kind: 'code', text: 'du code' },
      { kind: 'text', text: ' et un ' },
      { kind: 'link', text: 'lien', href: 'https://x.tld/a' },
    ]);
  });

  it('keeps plain text untouched', () => {
    assert.deepEqual(parseInline('juste du texte'), [{ kind: 'text', text: 'juste du texte' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses the PlanB video directive', () => {
    const blocks = parseMarkdown(':::video id=758d7d3b-84e6-4f52-bf43-967a2ce7e7ec:::');
    assert.deepEqual(blocks, [{ kind: 'video', videoId: '758d7d3b-84e6-4f52-bf43-967a2ce7e7ec' }]);
  });

  it('parses standalone images as blocks', () => {
    const blocks = parseMarkdown('![légende](assets/fr/001.webp)');
    assert.deepEqual(blocks, [{ kind: 'image', src: 'assets/fr/001.webp', alt: 'légende' }]);
  });

  it('does not treat headings inside code fences as structure', () => {
    const blocks = parseMarkdown('```sh\n# commentaire shell\necho ok\n```');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'code');
    assert.match((blocks[0] as { text: string }).text, /commentaire shell/);
  });

  it('parses tables with separator row dropped', () => {
    const blocks = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    assert.equal(blocks[0].kind, 'table');
    const table = blocks[0] as { header: unknown[]; rows: unknown[][] };
    assert.equal(table.header.length, 2);
    assert.equal(table.rows.length, 1);
  });

  it('groups list items and detects ordered lists', () => {
    const blocks = parseMarkdown('1. un\n2. deux\n\n- a\n- b');
    assert.equal(blocks.length, 2);
    assert.deepEqual(
      blocks.map((b) => (b as { ordered?: boolean }).ordered),
      [true, false],
    );
  });

  it('merges wrapped lines into one paragraph and splits on blank lines', () => {
    const blocks = parseMarkdown('ligne un\nligne deux\n\nautre paragraphe');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].kind, 'paragraph');
  });

  it('parses blockquotes', () => {
    const blocks = parseMarkdown('> citation sur\n> deux lignes');
    assert.deepEqual(blocks, [
      { kind: 'quote', inline: [{ kind: 'text', text: 'citation sur deux lignes' }] },
    ]);
  });
});

describe('resolveAssetUrl', () => {
  it('resolves relative paths against the pinned asset base', () => {
    assert.equal(
      resolveAssetUrl('assets/fr/001.webp', 'https://raw.example/c0ffee/courses/btc101/'),
      'https://raw.example/c0ffee/courses/btc101/assets/fr/001.webp',
    );
  });

  it('passes absolute URLs through', () => {
    assert.equal(resolveAssetUrl('https://a.tld/x.png', 'https://raw.example/'), 'https://a.tld/x.png');
  });
});

describe('annotateAnchors', () => {
  it('highlights the first occurrence only, case-insensitive', () => {
    const blocks = parseMarkdown('Le halving arrive. Un halving encore.');
    const { blocks: out, matched } = annotateAnchors(blocks, [{ id: 'h1', text: 'Halving' }]);
    assert.deepEqual([...matched], ['h1']);
    const inline = (out[0] as { inline: unknown[] }).inline as { kind: string; text: string }[];
    assert.deepEqual(
      inline.map((n) => n.kind),
      ['text', 'anchor', 'text'],
    );
    assert.equal(inline[1].text, 'halving');
    assert.match(inline[2].text, /Un halving encore/);
  });

  it('promotes a whole link when the match sits inside it', () => {
    const blocks = parseMarkdown('Voir le [bloc Genesis](https://x.tld/g) pour comprendre.');
    const { blocks: out, matched } = annotateAnchors(blocks, [{ id: 'g', text: 'bloc Genesis' }]);
    assert.ok(matched.has('g'));
    const inline = (out[0] as { inline: { kind: string }[] }).inline;
    assert.ok(inline.some((n) => n.kind === 'anchor'));
    assert.ok(!inline.some((n) => n.kind === 'link'));
  });

  it('reports unmatched matchers for the card fallback', () => {
    const blocks = parseMarkdown('Rien à voir ici.');
    const { matched } = annotateAnchors(blocks, [{ id: 'p', text: 'pizzas' }]);
    assert.equal(matched.size, 0);
  });

  it('leaves code blocks and headings untouched', () => {
    const blocks = parseMarkdown('# halving\n\n```\nhalving\n```');
    const { matched } = annotateAnchors(blocks, [{ id: 'h', text: 'halving' }]);
    assert.equal(matched.size, 0);
  });
});

describe('normalizeLinkHref', () => {
  it('passes https links through', () => {
    assert.equal(normalizeLinkHref('https://a.tld/x', 'base/'), 'https://a.tld/x');
  });

  it('adds https to protocol-less domains', () => {
    assert.equal(normalizeLinkHref('www.bitcoincore.org', 'base/'), 'https://www.bitcoincore.org');
    assert.equal(normalizeLinkHref('bitcoin.org/bitcoin.pdf', 'base/'), 'https://bitcoin.org/bitcoin.pdf');
  });

  it('strips stray wrapping parens', () => {
    assert.equal(normalizeLinkHref('(https://a.tld/x', 'base/'), 'https://a.tld/x');
  });

  it('resolves relative paths against the asset base', () => {
    assert.equal(normalizeLinkHref('./assets/fr/001.webp', 'https://raw.example/c/'), 'https://raw.example/c/assets/fr/001.webp');
  });
});
