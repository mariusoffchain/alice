#!/usr/bin/env node
// Replay formatting only, never inference. This verifies the model-specific
// template actually includes the evidence recorded by the generation harness.
import { redactLocalPaths } from './rag-eval-runtime.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
assert.ok(value('--report') && value('--output'), 'Require --report and --output');
const endpoint = new URL(value('--endpoint') ?? 'http://127.0.0.1:18083');
assert.equal(endpoint.protocol, 'http:');
assert.equal(endpoint.hostname, '127.0.0.1');
assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && endpoint.pathname === '/');
const bytes = await readFile(value('--report'));
const report = JSON.parse(bytes);
assert.equal(report.status, 'completed');
async function request(path, body) {
  const result = await fetch(new URL(path, endpoint), {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  assert.ok(result.ok, `Template service HTTP ${result.status}`);
  return result.json();
}
const props = await request('/props');
// Reports store redacted paths; compare the live path in the same redacted form.
assert.equal(redactLocalPaths(props.model_path), report.model.server.data[0].id);
assert.equal(resolve(props.model_path), props.model_path);
const hash = createHash('sha256');
for await (const chunk of createReadStream(props.model_path)) hash.update(chunk);
assert.equal(hash.digest('hex'), report.model.sha256);
const rows = [];
for (const row of report.rows) {
  for (const [call, body] of row.requests.entries()) {
    assert.equal(body.model, redactLocalPaths(props.model_path));
    const rendered = await request('/apply-template', body);
    assert.equal(typeof rendered.prompt, 'string');
    const required = {
      userQuestion: row.question,
      ...(row.context?.ragContext ? { ragContext: row.context.ragContext } : {}),
      ...(row.context?.learnContext ? { learnContext: row.context.learnContext } : {}),
      languageReminder: body.messages.at(-2).content,
      // Known model switches are template directives, removed by SmolLM3.
      leadingPolicy: body.messages[0].content.replace(/\/no_think|\/think/g, '').trim(),
    };
    const present = Object.fromEntries(Object.entries(required).map(([name, content]) => [name, rendered.prompt.includes(content)]));
    rows.push({ id: row.id, call, present, passed: Object.values(present).every(Boolean), renderedPrompt: rendered.prompt });
  }
}
assert.ok(rows.length > 0);
const output = {
  date: new Date().toISOString(), generationReportSha256: createHash('sha256').update(bytes).digest('hex'),
  methodology: 'Formatting replay of recorded requests on a caller-owned loopback server with verified model path/hash. No inference, wallet, provider or model-setting mutation. Exact evidence, leading policy (except known thinking switches), reminder and question inclusion checked after actual /apply-template rendering. This is prompt-preservation evidence, not instruction-following or device quality.',
  serverBuild: props.build_info, modelPath: props.model_path, modelSha256: report.model.sha256,
  chatTemplate: props.chat_template, calls: rows.length, passed: rows.every(row => row.passed), rows,
};
await writeFile(value('--output'), JSON.stringify(redactLocalPaths(output), null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ calls: rows.length, passed: output.passed, failures: rows.filter(row => !row.passed).map(({ id, call, present }) => ({ id, call, present })) }));
process.exitCode = output.passed ? 0 : 1;
