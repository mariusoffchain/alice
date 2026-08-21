// Minimal markdown → AST parser for PlanB course content. The app has no
// markdown dependency (the chat renderer is line-based and chat-specific), and
// Learn needs structures the chat never meets: fenced code, images with a
// remote asset base, tables, blockquotes and :::video::: directives. Keeping
// the parser pure makes it testable under the native node:test runner.

export type LearnInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  // An on-chain anchor highlighted in place (see annotateAnchors below).
  | { kind: 'anchor'; text: string; anchorId: string };

export type LearnBlock =
  | { kind: 'heading'; level: number; inline: LearnInline[] }
  | { kind: 'paragraph'; inline: LearnInline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'quote'; inline: LearnInline[] }
  | { kind: 'list'; ordered: boolean; items: LearnInline[][] }
  | { kind: 'table'; header: LearnInline[][]; rows: LearnInline[][][] }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'video'; videoId: string }
  | { kind: 'hr' };

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|!?\[[^\]]*\]\([^)\s]+\))/g;
const VIDEO_RE = /^:::video\s+id=([0-9a-f-]{36})\s*:::\s*$/;
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

export function parseInline(text: string): LearnInline[] {
  const nodes: LearnInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const token = match[0];
    if (match.index > last) nodes.push({ kind: 'text', text: text.slice(last, match.index) });
    if (token.startsWith('**')) {
      nodes.push({ kind: 'bold', text: token.slice(2, -2) });
    } else if (token.startsWith('`')) {
      nodes.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('![')) {
      // Inline image inside a sentence: keep the alt text, the block-level
      // image path is handled by parseMarkdown.
      const m = token.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      nodes.push({ kind: 'text', text: m?.[1] ?? '' });
    } else if (token.startsWith('[')) {
      const m = token.match(/^\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (m) nodes.push({ kind: 'link', text: m[1], href: m[2] });
    } else if (token.startsWith('*')) {
      nodes.push({ kind: 'italic', text: token.slice(1, -1) });
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push({ kind: 'text', text: text.slice(last) });
  return nodes;
}

function parseTableRow(line: string): LearnInline[][] {
  return line
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()));
}

const isTableSeparator = (line: string) => /^\|?\s*:?-{3,}[-\s|:]*$/.test(line.trim());

export function parseMarkdown(markdown: string): LearnBlock[] {
  const blocks: LearnBlock[] = [];
  const lines = markdown.split('\n');
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push({ kind: 'paragraph', inline: parseInline(text) });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const fence = trimmed.match(/^(```|~~~)\s*(\S*)/);
    if (fence) {
      flushParagraph();
      const buffer: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        buffer.push(lines[i]);
        i++;
      }
      blocks.push({ kind: 'code', lang: fence[2] ?? '', text: buffer.join('\n') });
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const video = trimmed.match(VIDEO_RE);
    if (video) {
      flushParagraph();
      blocks.push({ kind: 'video', videoId: video[1] });
      continue;
    }

    const image = trimmed.match(IMAGE_RE);
    if (image) {
      flushParagraph();
      blocks.push({ kind: 'image', src: image[2], alt: image[1] });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1].length, inline: parseInline(heading[2]) });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: 'hr' });
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      i--;
      blocks.push({ kind: 'quote', inline: parseInline(quoteLines.join(' ').trim()) });
      continue;
    }

    const listItem = trimmed.match(/^([-*+]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      flushParagraph();
      const ordered = /^\d/.test(listItem[1]);
      const items: LearnInline[][] = [];
      while (i < lines.length) {
        const itemMatch = lines[i].trim().match(/^([-*+]|\d+[.)])\s+(.*)$/);
        if (!itemMatch) break;
        items.push(parseInline(itemMatch[2]));
        i++;
      }
      i--;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const header = parseTableRow(trimmed);
      i += 2;
      const rows: LearnInline[][][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseTableRow(lines[i].trim()));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();
  return blocks;
}

export interface AnchorMatcher {
  id: string;
  /** Plain string to find (case-insensitive), in the reading language. */
  text: string;
}

/**
 * Highlight editorial anchors in place: the FIRST occurrence of each
 * matcher's text (case-insensitive, inside plain text or an existing link)
 * becomes an { kind: 'anchor' } inline node the renderer turns into a click
 * into the Explorer. Pure and non-destructive: returns new blocks plus the
 * set of matcher ids actually found, so the caller can keep the
 * end-of-chapter card as the fallback for the rest. An anchor beats a
 * glossary link on the same words: our product surface wins.
 */
export function annotateAnchors(
  blocks: LearnBlock[],
  matchers: AnchorMatcher[],
): { blocks: LearnBlock[]; matched: Set<string> } {
  const matched = new Set<string>();
  if (matchers.length === 0) return { blocks, matched };
  const pending = [...matchers];

  const annotateInline = (nodes: LearnInline[]): LearnInline[] => {
    if (pending.length === 0) return nodes;
    const out: LearnInline[] = [];
    for (const node of nodes) {
      if (pending.length === 0 || (node.kind !== 'text' && node.kind !== 'link')) {
        out.push(node);
        continue;
      }
      const lower = node.text.toLowerCase();
      const hitIndex = pending.findIndex((m) => lower.includes(m.text.toLowerCase()));
      if (hitIndex === -1) {
        out.push(node);
        continue;
      }
      const matcher = pending.splice(hitIndex, 1)[0];
      matched.add(matcher.id);
      const at = lower.indexOf(matcher.text.toLowerCase());
      const before = node.text.slice(0, at);
      const hit = node.text.slice(at, at + matcher.text.length);
      const after = node.text.slice(at + matcher.text.length);
      if (node.kind === 'link') {
        // The whole link becomes the anchor: splitting an <a> in three reads
        // worse than promoting it.
        out.push({ kind: 'anchor', text: node.text, anchorId: matcher.id });
      } else {
        if (before) out.push({ kind: 'text', text: before });
        out.push({ kind: 'anchor', text: hit, anchorId: matcher.id });
        if (after) out.push(...annotateInline([{ kind: 'text', text: after }]));
      }
    }
    return out;
  };

  const annotated = blocks.map((block): LearnBlock => {
    switch (block.kind) {
      case 'paragraph':
        return { ...block, inline: annotateInline(block.inline) };
      case 'quote':
        return { ...block, inline: annotateInline(block.inline) };
      case 'list':
        return { ...block, items: block.items.map((item) => annotateInline(item)) };
      default:
        return block;
    }
  });
  return { blocks: annotated, matched };
}

/**
 * Resolve a relative course asset path ("assets/fr/001.webp") against the
 * pack's pinned raw.githubusercontent base. Absolute URLs pass through.
 */
export function resolveAssetUrl(src: string, assetBase: string): string {
  if (/^https?:\/\//.test(src)) return src;
  return assetBase + src.replace(/^\.\//, '');
}

/**
 * Normalize the messy link hrefs found in the corpus so none of them ever
 * navigates the app itself: protocol-less domains get https, stray wrapping
 * parens are stripped, and relative paths resolve against the pinned asset
 * base like images do.
 */
export function normalizeLinkHref(href: string, assetBase: string): string {
  let url = href.trim().replace(/^\(+/, '');
  if (/^https?:\/\//.test(url)) return url;
  if (/^www\./i.test(url) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(url)) return `https://${url}`;
  return resolveAssetUrl(url, assetBase);
}
