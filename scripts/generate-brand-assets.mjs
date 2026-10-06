// Rebuild web brand assets from the approved vector masters. Mobile stays unchanged.
// Run from the repository root: node scripts/generate-brand-assets.mjs
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const symbol = await readFile(join(root, 'assets/brand/alice-symbol.svg'), 'utf8');
const wordmark = await readFile(join(root, 'assets/brand/alice-wordmark.svg'), 'utf8');
const pathData = svg => {
  const match = svg.match(/<path d="([^"]+)"/);
  if (!match) throw new Error('Missing brand path');
  return match[1];
};
const module = `// Vector paths from assets/brand; refresh with scripts/generate-brand-assets.mjs.
export const ALICE_SYMBOL_PATH = ${JSON.stringify(pathData(symbol))};
export const ALICE_WORDMARK_PATH = ${JSON.stringify(pathData(wordmark))};
`;
const blue = svg => svg.replace('fill="currentColor"', 'fill="#8bb8ff"');
const body = symbol.replace(/^<svg[^>]*>/, '').replace(/<title>.*?<\/title>/, '').replace('</svg>', '');
const icon = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="#0d1117"/><g fill="#8bb8ff" transform="translate(40 40) scale(3.666666667)" shape-rendering="crispEdges">${body}</g></svg>`);
for (const app of ['site', 'app-web']) {
  const appDir = join(root, 'apps', app);
  const publicDir = join(appDir, 'public');
  await writeFile(join(appDir, 'src/lib/brand.ts'), module);
  await writeFile(join(publicDir, 'alice-logo.svg'), blue(wordmark));
  await writeFile(join(publicDir, 'alice-symbol.svg'), blue(symbol));
  await sharp(Buffer.from(blue(symbol))).resize(32, 32).png().toFile(join(publicDir, 'favicon.png'));
  const icons = app === 'site' ? publicDir : join(publicDir, 'icons');
  await mkdir(icons, { recursive: true });
  await sharp(icon).resize(180, 180).png().toFile(join(icons, 'apple-touch-icon.png'));
  if (app === 'app-web') {
    for (const size of [192, 512]) {
      await sharp(icon).resize(size, size).png().toFile(join(icons, `icon-${size}.png`));
    }
  }
}
console.log('D2 web assets rebuilt for site and app-web.');
