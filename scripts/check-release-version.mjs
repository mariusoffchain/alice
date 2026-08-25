import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
let checked = 0;

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function expectEqual(label, actual, expected) {
  checked += 1;
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectMatch(relativePath, label, pattern, expected) {
  const match = readText(relativePath).match(pattern);
  expectEqual(`${relativePath} (${label})`, match?.[1], expected);
}

const releaseVersion = readJson('package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) {
  failures.push(`package.json: invalid release version ${JSON.stringify(releaseVersion)}`);
}

const workspaceManifests = [];
for (const parent of ['apps', 'packages']) {
  for (const entry of fs.readdirSync(path.join(ROOT, parent), { withFileTypes: true })) {
    const relativePath = `${parent}/${entry.name}/package.json`;
    if (entry.isDirectory() && fs.existsSync(path.join(ROOT, relativePath))) {
      workspaceManifests.push(relativePath);
    }
  }
}
workspaceManifests.sort();

for (const relativePath of workspaceManifests) {
  expectEqual(relativePath, readJson(relativePath).version, releaseVersion);
}

const packageLock = readJson('package-lock.json');
expectEqual('package-lock.json (root version)', packageLock.version, releaseVersion);
expectEqual('package-lock.json (root package)', packageLock.packages?.['']?.version, releaseVersion);
for (const relativePath of workspaceManifests) {
  const workspacePath = path.posix.dirname(relativePath);
  expectEqual(`package-lock.json (${workspacePath})`, packageLock.packages?.[workspacePath]?.version, releaseVersion);
}

expectEqual('apps/wallet-mobile/app.json', readJson('apps/wallet-mobile/app.json').expo?.version, releaseVersion);
expectEqual('apps/app-desktop/src-tauri/tauri.conf.json', readJson('apps/app-desktop/src-tauri/tauri.conf.json').version, releaseVersion);
expectEqual(
  'apps/wallet-mobile/eas.json (production app version)',
  readJson('apps/wallet-mobile/eas.json').build?.production?.env?.EXPO_PUBLIC_ALICE_APP_VERSION,
  releaseVersion,
);

expectMatch(
  'apps/app-desktop/src-tauri/Cargo.toml',
  'package version',
  /^version = "([^"]+)"/m,
  releaseVersion,
);
expectMatch(
  'apps/app-desktop/src-tauri/Cargo.lock',
  'alice-desktop package version',
  /\[\[package\]\]\nname = "alice-desktop"\nversion = "([^"]+)"/,
  releaseVersion,
);
expectMatch(
  'apps/venice-proxy-worker/src/app-release.ts',
  'Worker release endpoint',
  /APP_RELEASE_VERSION = '([^']+)'/,
  releaseVersion,
);
expectMatch(
  'packages/alice-ai/src/whats-new.ts',
  'newest in-app release notes',
  /WHATS_NEW:[\s\S]*?version: '([^']+)'/,
  releaseVersion,
);
expectMatch(
  '.env.example',
  'example client version',
  /^EXPO_PUBLIC_ALICE_APP_VERSION=([^\s#]+)$/m,
  releaseVersion,
);
expectMatch(
  'apps/wallet-mobile/.env.example',
  'example client version',
  /^EXPO_PUBLIC_ALICE_APP_VERSION=([^\s#]+)$/m,
  releaseVersion,
);
expectMatch(
  'CHANGELOG.md',
  'current release marker',
  /^- `([^`]+)`, current release$/m,
  releaseVersion,
);
expectMatch(
  'CHANGELOG.md',
  'release section',
  /^## (\d+\.\d+\.\d+)$/m,
  releaseVersion,
);

if (failures.length > 0) {
  console.error(`Release version check failed (${failures.length}/${checked} mismatches):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Release version ${releaseVersion} is consistent across ${checked} declarations.`);
