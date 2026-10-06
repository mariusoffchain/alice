import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';

test('the real Learn catalog/provider follows conversation language instead of reader preference', async t => {
  const bundled = await build({
    stdin: {
      contents: `
        export { registerLearnTurnContext } from './apps/app-web/src/lib/learn/turn-context.ts';
        export { learnContextFor } from './packages/alice-ai/src/learn-context.ts';
      `,
      resolveDir: process.cwd(), loader: 'ts',
    },
    bundle: true, write: false, platform: 'node', format: 'esm',
    alias: {
      '@alice-wallet/alice-ai': resolve('packages/alice-ai/src/learn-context.ts'),
      '@alice-wallet/alice-content': resolve('packages/alice-content'),
    },
  });
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    const markdown = 'Bitcoin wallet recovery phrase backup. Sauvegarder la phrase de récupération du portefeuille Bitcoin.';
    return new Response(JSON.stringify({
      name: 'Recovery', markdown,
      parts: [{ title: 'Recovery', chapters: [{ title: markdown, markdown }] }],
    }), { status: 200 });
  });
  runtime.registerLearnTurnContext();
  const fr = await runtime.learnContextFor('Comment sauvegarder mon portefeuille Bitcoin et ma phrase de récupération ?', { targetLanguage: 'fr' });
  assert.ok(fr?.excerpt);
  assert.ok(urls.at(-1)?.startsWith('/learn/fr/'), JSON.stringify(urls));
  const en = await runtime.learnContextFor('How do I back up my Bitcoin wallet recovery phrase?', { targetLanguage: 'en' });
  assert.ok(en?.excerpt);
  assert.ok(urls.at(-1)?.startsWith('/learn/en/'), JSON.stringify(urls));
});
