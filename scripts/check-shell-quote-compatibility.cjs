const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const [beforePath, afterPath, outputPath] = process.argv.slice(2);
assert.ok(beforePath && afterPath, 'Usage: node scripts/check-shell-quote-compatibility.cjs <old-package-dir> <new-package-dir> [report.json]');
const before = require(path.resolve(beforePath));
const after = require(path.resolve(afterPath));
const args = [[], ['editor', '/tmp/file with spaces.ts', '--line', '42'], ["a'b", 'a"b', 'a\\b', ''], ['écriture', '路径', '$HOME', '`text`', ';', '#', '|', '&', '*', '?', '(x)']];
let checks = 0;
for (const row of args) {
  assert.deepEqual(after.parse(after.quote(row)), before.parse(before.quote(row))); checks++;
  if (!row.some(arg => arg === '*' || arg === '?')) { assert.deepEqual(after.parse(after.quote(row)), row); checks++; }
  assert.equal(after.quote(row), before.quote(row)); checks++;
}
for (const input of ["editor 'file name.ts' --line 42", 'a | b && c; d', 'a # comment', '"$NAME" x', 'a\\ b', 'a* b?', "'a'\"b\"c", 'echo ${NAME}']) {
 assert.deepEqual(after.parse(input, { NAME: 'a value' }), before.parse(input, { NAME: 'a value' })); checks++;
}
const start = performance.now();
const tokens = after.parse('x '.repeat(16000));
assert.equal(tokens.length, 16000); checks++;
const report = { checks, result: 'passed', installed: require(path.resolve(afterPath, 'package.json')).version, largeInputTokens: tokens.length, largeInputMs: performance.now() - start, scope: 'CLI argument quoting/parsing compatibility; strings only, no shell execution. Large-input timing is a local observation, not a universal complexity proof.' };
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(report, null, 2)+'\n');
console.log(report);
