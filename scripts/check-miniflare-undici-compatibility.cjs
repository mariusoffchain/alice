#!/usr/bin/env node
// Caller-owned local Miniflare runtimes only; no provider, wallet or external fetch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

async function check(root, parent) {
  const dir = path.join(root, parent);
  const req = createRequire(path.join(dir, 'package.json'));
  const mf = req('./dist/src/index.js');
  const version = req('./package.json').version;
  const undici = req('undici/package.json').version;
  const checks = [];
  const request = new mf.Request('http://localhost/synthetic', { cf: { country: 'ZZ' } });
  assert.deepEqual(request.clone().cf, { country: 'ZZ' });
  const response = new mf.Response('synthetic body', { status: 201 });
  assert.equal(await response.clone().text(), 'synthetic body');
  assert.equal(response.status, 201);
  assert.equal(mf.Response.error().status, 0);
  const redirect = mf.Response.redirect('https://example.invalid/no-fetch', 302);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.invalid/no-fetch');
  const pair = new mf.WebSocketPair();
  const upgrade = new mf.Response(null, { status: 101, webSocket: pair[0] });
  assert.equal(upgrade.status, 101);
  assert.equal(upgrade.webSocket, pair[0]);
  assert.throws(() => upgrade.clone(), /WebSocket handshake/);
  checks.push('Request/Response subclass, clone, cf metadata, error, redirect, upgrade invariants');
  const script = `export default { async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/stream') {
      let n = 0;
      return new Response(new ReadableStream({ async pull(controller) {
        if (n === 32) { controller.close(); return; }
        controller.enqueue(new TextEncoder().encode(String(n).padStart(2, '0') + ':x'.repeat(8192) + '\\n'));
        n++; await new Promise(resolve => setTimeout(resolve, 2));
      }}), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (pathname === '/slow') { await new Promise(resolve => setTimeout(resolve, 15000)); return new Response('late'); }
    if (pathname === '/ws') {
      const pair = new WebSocketPair(); pair[1].accept();
      pair[1].addEventListener('message', event => pair[1].send('echo:' + event.data));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response(await request.text(), { status: 202, headers: { 'x-synthetic': 'yes' } });
  }};`;
  const options = { modules: true, script, host: '127.0.0.1', port: 0, cf: false,
    compatibilityDate: '2026-07-01', log: new mf.Log(mf.LogLevel.NONE) };
  const runtime = new mf.Miniflare(version.startsWith('5.') ? mf.convertV4MiniflareOptions(options) : options);
  try {
    await runtime.ready;
    const streamed = await runtime.dispatchFetch('http://local.test/stream');
    assert.equal(streamed.status, 200);
    assert.equal(streamed.headers.get('content-type'), 'text/event-stream');
    const expected = Array.from({ length: 32 }, (_, i) => String(i).padStart(2, '0') + ':x'.repeat(8192) + '\n').join('');
    assert.equal(await streamed.text(), expected);
    checks.push(`actual dispatchFetch streaming preserves 32 ordered chunks / ${Buffer.byteLength(expected)} bytes`);
    const echo = await runtime.dispatchFetch('http://local.test/echo', { method: 'POST', body: 'synthetic request bytes' });
    assert.equal(echo.status, 202);
    assert.equal(echo.headers.get('x-synthetic'), 'yes');
    assert.equal(await echo.text(), 'synthetic request bytes');
    checks.push('actual dispatchFetch POST body/status/headers');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 80);
    try {
      await assert.rejects(runtime.dispatchFetch('http://local.test/slow', { signal: abort.signal }), e => e.name === 'AbortError');
    } finally { clearTimeout(timer); }
    assert.equal(await (await runtime.dispatchFetch('http://local.test/echo', { method: 'POST', body: 'after abort' })).text(), 'after abort');
    checks.push('in-flight dispatchFetch abort rejects; subsequent dispatcher request succeeds');
    const wsResponse = await runtime.dispatchFetch('http://local.test/ws', { headers: { Upgrade: 'websocket' } });
    assert.equal(wsResponse.status, 101);
    const ws = wsResponse.webSocket;
    assert.ok(ws); ws.accept();
    const echoed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket echo timeout')), 3000);
      ws.addEventListener('message', event => { clearTimeout(timeout); resolve(event.data); }, { once: true });
      ws.addEventListener('error', event => { clearTimeout(timeout); reject(new Error(String(event.error))); }, { once: true });
    });
    ws.send('synthetic'); assert.equal(await echoed, 'echo:synthetic'); ws.close(1000, 'done');
    checks.push('actual Miniflare/ws upgrade and synthetic echo (not Undici WebSocket API)');
  } finally { await runtime.dispose(); }
  checks.push('runtime disposal completes');
  return { root, parent, miniflareVersion: version, resolvedUndici: undici, passed: true, checks };
}
if (process.argv[2] === '--child') {
  check(process.argv[3], process.argv[4]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.stack); process.exitCode = 1; });
} else {
  const [before, after, output] = process.argv.slice(2);
  assert.ok(before && after && output, 'Usage: script old-installed-checkout new-installed-checkout new-report.json');
  const rows = [];
  for (const root of [before, after]) for (const parent of ['apps/venice-proxy-worker/node_modules/miniflare', 'node_modules/miniflare']) {
    const run = spawnSync(process.execPath, [__filename, '--child', root, parent], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
    let result;
    try { result = JSON.parse(run.stdout.trim().split('\n').at(-1)); } catch {}
    rows.push({ root, parent, exitCode: run.status, error: run.error?.message, stderr: run.stderr,
      ...(result ?? { passed: false, stdout: run.stdout }) });
  }
  const report = { date: new Date().toISOString(), methodology: 'Unmodified installed Miniflare 4/5, respective real resolved Undici, separate bounded processes, loopback workerd/dispatchFetch. No provider calls or credentials. Synthetic streamed response, abort, POST and Miniflare WebSocket plus Response subclass tests. Does not prove cloud E2EE or all Undici security properties.', passed: rows.every(row => row.passed && row.exitCode === 0), rows };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
  process.exitCode = report.passed ? 0 : 1;
}
