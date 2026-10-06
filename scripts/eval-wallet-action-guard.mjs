#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadRagEvaluationRuntime, redactLocalPaths } from './rag-eval-runtime.mjs';

const output = process.argv[process.argv.indexOf('--output') + 1];
assert.ok(process.argv.includes('--output') && output);
const fixturePath = 'scripts/data/rag-query-eval/generation-development-42-2026-10-04.json';
const bytes = await readFile(fixturePath);
const fixture = JSON.parse(bytes);
const runtime = await loadRagEvaluationRuntime(`
  export { planAliceTurn } from './packages/alice-ai/src/turn-planner.ts';
  export { prepareAliceTurn } from './packages/alice-ai/src/turn-engine.ts';
`);
const plans = fixture.cases.map(row => ({ id: row.id, ...runtime.planAliceTurn(row.question) }));
assert.deepEqual(plans.filter(row => row.walletActionReason).map(row => row.id), ['en-19', 'fr-19']);
assert.deepEqual(plans.filter(row => row.walletStateReason).map(row => row.id), ['en-18', 'fr-18']);
const rows = [];
let serviceCalls = 0;
const forbidden = () => { serviceCalls++; throw Error('No preparation service may run'); };
const services = {
  recordPedagogicalSignal: forbidden, retrieveKnowledge: forbidden,
  getMemory: forbidden, rememberMemoryCandidates: forbidden,
  pedagogicalContext: forbidden, memoryContext: forbidden, memoryCaptureInstruction: '',
};
for (const backendType of ['local', 'cloud', 'custom']) {
  for (const row of fixture.cases.filter(row => /-19$/.test(row.id))) {
    const history = [...row.history, { role: 'user', content: row.question }];
    const prepared = await runtime.prepareAliceTurn({ history, userMessage: row.question, backendType, targetLanguage: row.language }, services);
    assert.equal(prepared.plan.walletActionReason, 'send-payment');
    assert.equal(prepared.diagnostics.retrieval, 'none');
    assert.ok(prepared.directResponse);
    assert.deepEqual(prepared.explicitMemoryCandidates, []);
    assert.deepEqual(prepared.history, history);
    rows.push({ id: row.id, backendType, question: row.question, directResponse: prepared.directResponse, diagnostics: prepared.diagnostics });
  }
}
assert.equal(serviceCalls, 0);
const sourceFiles = ['packages/alice-ai/src/wallet-action-guard.ts', 'packages/alice-ai/src/turn-planner.ts', 'packages/alice-ai/src/turn-engine.ts', 'packages/alice-ai/src/rag-query-rewrite.ts', 'scripts/eval-wallet-action-guard.mjs'];
const report = {
  date: new Date().toISOString(), baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  gitStatus: execFileSync('git', ['status', '--short', '--untracked-files=all'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  methodology: 'Deterministic production planner/turn-engine evaluation of unchanged development questions. All preparation services throw. No model, wallet, external account, network, native bridge, cloud inference or UI is invoked. These 6 responses are not generated answers and do not count toward the model-generation gate. Full fixture classification verifies other educational cases are not swallowed; bounded FR/EN matching is not exhaustive intent understanding.',
  fixturePath, fixtureSha256: createHash('sha256').update(bytes).digest('hex'),
  sourceSha256: Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')]))),
  directResponses: rows.length, generatedAnswers: 0, serviceCalls, plans, rows,
};
await writeFile(output, JSON.stringify(redactLocalPaths(report), null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ directResponses: rows.length, generatedAnswers: 0, serviceCalls }));
