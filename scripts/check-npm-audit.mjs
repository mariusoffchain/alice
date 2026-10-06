#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REVIEW_BY = '2026-11-02';
// Reviewed 2026-10-05. Only the 2 direct advisories below remain (braces and
// node-forge, both still without a patched release); other package findings
// are propagation through their dependency chains. The ws exception under
// viem is closed: the scoped override now resolves it to 8.22.0.
// See docs/security/dependency-audit.md.
const KNOWN_HIGH_PACKAGES = new Set([
  '@arkade-os/boltz-swap',
  '@arkade-os/sdk',
  '@expo/cli',
  '@expo/code-signing-certificates',
  '@expo/metro',
  '@expo/metro-config',
  '@jest/environment',
  '@jest/fake-timers',
  '@jest/transform',
  '@lendasat/lendaswap-sdk-pure',
  '@react-native/community-cli-plugin',
  '@satora/swap',
  'babel-jest',
  'braces',
  'expo',
  'jest-environment-node',
  'jest-haste-map',
  'jest-message-util',
  'metro',
  'metro-config',
  'metro-file-map',
  'metro-transform-worker',
  'micromatch',
  'node-forge',
  'react-native',
]);
const KNOWN_HIGH_ADVISORIES = new Set([1240992, 1240912]);
// Scope the exceptions to the exact reviewed package locations and versions.
const REVIEWED_HIGH_NODES = new Map([
  ['node_modules/braces', '3.0.3'],
  ['node_modules/node-forge', '1.4.0'],
]);
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error('npm audit did not return valid JSON. Check registry access.');
  process.exit(1);
}

if (report.error || !report.metadata?.vulnerabilities) {
  const message = report.error?.summary ?? report.error?.message ?? audit.stderr.trim();
  console.error(`npm audit failed: ${message || `exit code ${audit.status}`}`);
  process.exit(1);
}

const unexpectedPackages = [];
const unexpectedAdvisories = [];
const critical = [];
const unexpectedNodes = [];
for (const [name, finding] of Object.entries(report.vulnerabilities ?? {})) {
  if (finding.severity === 'critical') critical.push(name);
  if (finding.severity === 'high' && !KNOWN_HIGH_PACKAGES.has(name)) {
    unexpectedPackages.push(name);
  }
  for (const via of finding.via ?? []) {
    if (typeof via !== 'object' || via.severity !== 'high') continue;
    for (const node of finding.nodes ?? []) {
      if (REVIEWED_HIGH_NODES.get(node) !== lock.packages?.[node]?.version
          || !REVIEWED_HIGH_NODES.has(node)) unexpectedNodes.push(node);
    }
    if (!KNOWN_HIGH_ADVISORIES.has(via.source)) {
      unexpectedAdvisories.push(`${name}: ${via.url ?? via.source}`);
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
console.log(`npm audit: ${report.metadata?.vulnerabilities?.high ?? 0} high, ${report.metadata?.vulnerabilities?.critical ?? 0} critical`);
if (critical.length || unexpectedPackages.length || unexpectedAdvisories.length || unexpectedNodes.length || today > REVIEW_BY) {
  if (critical.length) console.error(`Critical vulnerabilities: ${critical.join(', ')}`);
  if (unexpectedPackages.length) console.error(`New high-risk packages: ${unexpectedPackages.join(', ')}`);
  if (unexpectedAdvisories.length) console.error(`New high-risk advisories: ${unexpectedAdvisories.join(', ')}`);
  if (unexpectedNodes.length) console.error(`Unreviewed high-risk locations or versions: ${[...new Set(unexpectedNodes)].join(', ')}`);
  if (today > REVIEW_BY) console.error(`The accepted audit baseline expired on ${REVIEW_BY}.`);
  process.exit(1);
}
