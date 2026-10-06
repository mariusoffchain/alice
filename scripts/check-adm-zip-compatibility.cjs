#!/usr/bin/env node
// Offline compatibility check of the actual ONNX installer with synthetic ZIPs.
// Never invokes postinstall, a shell, real feeds, or a binary from an archive.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const [oldRoot, newRoot, output] = process.argv.slice(2).map(x => path.resolve(x));
assert.ok(oldRoot && newRoot && output, 'Require old install root, new install root, report path');
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const roots = { old: oldRoot, candidate: newRoot };
const versions = {}, modules = {}, helpers = {};
for (const [label, root] of Object.entries(roots)) {
  const zipPath = path.join(root, 'node_modules/adm-zip');
  const helperPath = path.join(root, 'node_modules/onnxruntime-node/script/install-utils.js');
  versions[label] = { zip: require(path.join(zipPath, 'package.json')).version, onnx: require(path.join(root, 'node_modules/onnxruntime-node/package.json')).version, helperSha256: digest(helperPath) };
  modules[label] = require(zipPath);
  helpers[label] = require(helperPath);
}
assert.equal(versions.candidate.zip, '0.6.1');
assert.equal(versions.old.onnx, versions.candidate.onnx);
assert.equal(versions.old.helperSha256, versions.candidate.helperSha256);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-admzip-compat-'));
const packageInfo = { name: 'alice-fixture', versions: [{ feed: 'fixture', version: '1.0.0' }] };
const files = [
  ['runtimes/linux-x64/native/test.bin', Buffer.from('synthetic linux bytes')],
  ['runtimes/win-x64/native/test.bin', Buffer.from('synthetic windows bytes')],
  ['folder with spaces/empty.bin', Buffer.alloc(0)],
];
const makeZip = entries => {
  const zip = new modules.candidate();
  for (const [name, bytes] of entries) zip.addFile(name, bytes);
  return zip.toBuffer();
};
const archive = makeZip(files);
const cases = [];
async function runInstaller(label, includeMissing) {
  const requests = [];
  const originalGet = https.get;
  https.get = (url, callback) => {
    const responseBody = url === 'https://alice-fixture.invalid/index.json'
      ? Buffer.from(JSON.stringify({ resources: [{ '@type': 'PackageBaseAddress/3.0.0', '@id': 'https://alice-fixture.invalid/packages/' }] }))
      : url === 'https://alice-fixture.invalid/packages/alice-fixture/index.json'
        ? Buffer.from(JSON.stringify({ versions: ['1.0.0'] }))
        : url === 'https://alice-fixture.invalid/packages/alice-fixture/1.0.0/alice-fixture.1.0.0.nupkg' ? archive : null;
    assert.ok(responseBody, `Unexpected network request forbidden: ${url}`);
    requests.push(url);
    const request = new EventEmitter();
    process.nextTick(() => {
      const response = Readable.from([responseBody]);
      response.statusCode = 200;
      response.headers = { 'content-type': 'application/json' };
      callback(response);
    });
    return request;
  };
  const target = path.join(temp, label, includeMissing ? 'missing' : 'valid');
  const manifests = files.map(([name], i) => ({ packagesInfo: packageInfo, pathInPackage: name, filepath: path.join(target, String(i), path.basename(name)) }));
  if (includeMissing) manifests.push({ packagesInfo: packageInfo, pathInPackage: 'missing.bin', filepath: path.join(target, 'missing.bin') });
  try {
    const operation = helpers[label].installPackages([packageInfo], manifests, { fixture: { type: 'nuget', index: 'https://alice-fixture.invalid/index.json' } });
    if (includeMissing) await assert.rejects(operation, /Failed to find missing.bin/);
    else await operation;
    for (const [i, [, bytes]] of files.entries()) assert.deepEqual(fs.readFileSync(manifests[i].filepath), bytes);
    if (includeMissing) assert.equal(fs.existsSync(path.join(target, 'missing.bin')), false);
    assert.equal(requests.length, 3);
    cases.push({ name: `${label}:actual-installer-${includeMissing ? 'missing-entry-rejected' : 'nested-flat-empty-copy'}`, passed: true, requestsMocked: requests.length });
  } finally { https.get = originalGet; }
}
async function main() {
  for (const label of ['old', 'candidate']) { await runInstaller(label, false); await runInstaller(label, true); }
  // Candidate-only defensive checks. No vulnerable-library attack is executed.
  const duplicate = makeZip([['a.txt', Buffer.from('a')], ['b.txt', Buffer.from('b')]]);
  for (let i = duplicate.indexOf('b.txt'); i !== -1; i = duplicate.indexOf('b.txt', i + 5)) duplicate.write('a.txt', i);
  assert.throws(() => new modules.candidate(duplicate).getEntries(), /duplicate/i);
  cases.push({ name: 'candidate:duplicate-entry-rejected', passed: true });
  const target = path.join(temp, 'symlink-target');
  const outside = path.join(temp, 'outside.txt');
  fs.mkdirSync(target); fs.writeFileSync(outside, 'unchanged');
  fs.symlinkSync(outside, path.join(target, 'a.txt'));
  const zip = new modules.candidate(makeZip([['a.txt', Buffer.from('should not overwrite')]]));
  assert.throws(() => zip.extractEntryTo(zip.getEntry('a.txt'), target, false, true), /symlink/i);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
  cases.push({ name: 'candidate:destination-symlink-rejected', passed: true });
  const stored = new modules.candidate(); stored.addFile('tiny.bin', Buffer.from('abc'));
  stored.getEntry('tiny.bin').header.method = 0;
  const exaggerated = stored.toBuffer();
  const central = exaggerated.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central >= 0); assert.equal(exaggerated.readUInt16LE(central + 10), 0);
  exaggerated.writeUInt32LE(1024 * 1024, central + 24);
  const originalAlloc = Buffer.alloc;
  let maxAllocation = 0;
  try {
    Buffer.alloc = (size, ...rest) => { maxAllocation = Math.max(maxAllocation, size); assert.ok(size <= 65536, 'Oversized allocation blocked by test before allocation'); return originalAlloc(size, ...rest); };
    assert.deepEqual(new modules.candidate(exaggerated).getEntry('tiny.bin').getData(), Buffer.from('abc'));
  } finally { Buffer.alloc = originalAlloc; }
  cases.push({ name: 'candidate:stored-declared-size-does-not-drive-allocation', passed: true, declaredSize: 1048576, actualBytes: 3, maxObservedBufferAlloc: maxAllocation });
  const report = { date: new Date().toISOString(), node: process.version, versions, cases, passed: true, retainedSyntheticDirectory: temp, methodology: 'Actual unchanged ONNX installPackages called against mocked in-memory NuGet metadata/archive. No network, downloaded binary, or shell execution. Valid paths, duplicate basenames, empty data and missing entry checked on both versions. Candidate-only bounded defensive fixtures; not an exhaustive archive-security audit or Windows/GPU installation proof.' };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, checks: cases.length, versions }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
