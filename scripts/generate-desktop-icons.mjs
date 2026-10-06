// Regenerate desktop icons from the approved D2 master; no mobile assets are copied.
import { readFile, writeFile, mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(join(root, 'assets/brand/alice-symbol.svg'), 'utf8');
const body = source.replace(/^<svg[^>]*>/, '').replace(/<title>.*?<\/title>/, '').replace('</svg>', '');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="48" fill="#0d1117"/><g transform="translate(40 40) scale(3.666666667)" fill="#8bb8ff" shape-rendering="crispEdges">${body}</g></svg>`;
const input = join(root, 'assets/brand/alice-desktop.svg');
await writeFile(input, svg + '\n');
const temporary = await mkdtemp(join(tmpdir(), 'alice-desktop-icons-'));
execFileSync(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', input, '--output', temporary], { stdio: 'inherit' });
const names = ['32x32.png', '64x64.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.icns', 'icon.ico', 'StoreLogo.png', ...[30,44,71,89,107,142,150,284,310].map(size => `Square${size}x${size}Logo.png`)];
for (const name of names) await copyFile(join(temporary, name), join(root, 'apps/app-desktop/src-tauri/icons', name));
console.log(`Updated ${names.length} desktop icons. Intermediate output: ${temporary}`);
