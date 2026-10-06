import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('the frozen FR/EN reference set improves retrieval without individual regressions', () => {
  const output = execFileSync(process.execPath, ['scripts/eval-rag-query-rewrite.mjs', '--check'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
  });
  const report = JSON.parse(output);
  assert.equal(report.overall.candidate.cases, 80);
  assert.equal(report.byLanguage.fr.candidate.cases, 40);
  assert.equal(report.byLanguage.en.candidate.cases, 40);
  assert.equal(report.datasetSha256, '5f823a767ac8317224d7fb3f9434ef91efc89f923ebe203a97370fb238636b73');
});
