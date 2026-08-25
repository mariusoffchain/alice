// Renders the link-preview card into src/app/opengraph-image.png.
//
// Next's `opengraph-image.tsx` convention would generate the same picture, but
// this site is a static export with `trailingSlash: true`: the generated route
// has no file extension, so hosts redirect `/opengraph-image` to a trailing
// slash and serve it as application/octet-stream. Crawlers reject that. A real
// .png file in app/ keeps the same convention, the right Content-Type and no
// redirect.
//
// Run after changing the slogan or the artwork:
//   node scripts/generate-og.mjs
import { ImageResponse } from 'next/og.js';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(APP_DIR, 'public');

const HERO_TITLE = 'Your Bitcoin questions are nobody’s business.';

const SIZE = { width: 1200, height: 630 };
const GRID = 78;
const BG = '#0d1117';
const GRID_LINE = '#1a2333';
const PRIMARY = '#8bb8ff';
const HEADING = '#eaf1ff';

const [pixelFont, bodyFont, logo] = await Promise.all([
  readFile(join(PUBLIC, 'fonts', 'PressStart2P-Regular.ttf')),
  readFile(join(PUBLIC, 'fonts', 'terminal-grotesque.ttf')),
  readFile(join(PUBLIC, 'alice-logo.svg')),
]);
const logoSrc = `data:image/svg+xml;base64,${logo.toString('base64')}`;

const line = (style) => ({
  type: 'div',
  props: { style: { position: 'absolute', backgroundColor: GRID_LINE, ...style } },
});

const verticals = Array.from({ length: Math.floor(SIZE.width / GRID) }, (_, i) =>
  line({ left: (i + 1) * GRID, top: 0, width: 1, height: SIZE.height }),
);
const horizontals = Array.from({ length: Math.floor(SIZE.height / GRID) }, (_, i) =>
  line({ top: (i + 1) * GRID, left: 0, height: 1, width: SIZE.width }),
);

const text = (content, style) => ({ type: 'div', props: { style, children: content } });

const card = {
  type: 'div',
  props: {
    style: { width: '100%', height: '100%', display: 'flex', position: 'relative', backgroundColor: BG },
    children: [
      ...verticals,
      ...horizontals,
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 72px',
            width: 880,
          },
          children: [
            text('PRIVATE BITCOIN AI · SELF-CUSTODY · OPEN SOURCE', {
              fontFamily: 'PressStart2P',
              fontSize: 13,
              color: PRIMARY,
              letterSpacing: 2,
            }),
            text(HERO_TITLE, {
              fontFamily: 'TerminalGrotesque',
              fontSize: 62,
              lineHeight: 1.18,
              color: HEADING,
              marginTop: 40,
            }),
            text('alicebtc.com', {
              fontFamily: 'TerminalGrotesque',
              fontSize: 28,
              color: PRIMARY,
              marginTop: 40,
            }),
          ],
        },
      },
      {
        type: 'div',
        props: {
          style: { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' },
          children: [{ type: 'img', props: { src: logoSrc, width: 230, height: 230 } }],
        },
      },
    ],
  },
};

const response = new ImageResponse(card, {
  ...SIZE,
  fonts: [
    { name: 'PressStart2P', data: pixelFont, style: 'normal' },
    { name: 'TerminalGrotesque', data: bodyFont, style: 'normal' },
  ],
});

const out = join(APP_DIR, 'src', 'app', 'opengraph-image.png');
await writeFile(out, Buffer.from(await response.arrayBuffer()));
await writeFile(join(APP_DIR, 'src', 'app', 'opengraph-image.alt.txt'), HERO_TITLE);
console.log(`wrote ${out}`);
