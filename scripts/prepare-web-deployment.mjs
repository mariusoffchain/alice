import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Build Output API v3: upload the tested static export only. This does not
// retrieve Vercel environment variables or upload private source/configuration.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'apps/app-web/out');
const output = path.resolve(process.argv[2] ?? path.join(root, '.vercel/output'));
await readFile(path.join(source, 'index.html'));
await readFile(path.join(source, '404.html'));
// Require a fresh destination so old chunks cannot leak into a new deployment.
await mkdir(output, { recursive: false });
await cp(source, path.join(output, 'static'), { recursive: true });
const files = await readdir(source, { recursive: true });
const pageRoutes = files.filter(f => f === 'index.html' || f.endsWith('/index.html')).sort().map(f => {
  const route = f === 'index.html' ? '/' : `/${f.slice(0, -'index.html'.length)}`;
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    src: route === '/' ? '^/$' : `^${escaped.slice(0, -1)}/?$`,
    dest: `/${f}`,
    headers: { 'Cache-Control': 'public, max-age=0, must-revalidate' },
  };
});
await writeFile(path.join(output, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '/_next/static/(.*)', headers: { 'Cache-Control': 'public,max-age=31536000,immutable' }, continue: true },
    ...pageRoutes,
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/404.html', status: 404 },
  ],
}, null, 2) + '\n');
console.log(`Prepared ${pageRoutes.length} static page routes in ${output}`);
