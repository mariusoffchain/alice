#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const REVIEW_BY = '2026-10-20';
const KNOWN_HIGH_PACKAGES = new Set([
  // Reviewed 2026-09-22, see docs/security/dependency-audit.md for the
  // per-chain exposure rationale behind every entry.
  '@expo/cli',
  '@expo/metro',
  '@expo/metro-config',
  '@huggingface/transformers',
  '@lendasat/lendaswap-sdk-pure',
  '@satora/swap',
  'adm-zip',
  'brace-expansion',
  'expo',
  'image-size',
  'metro',
  'metro-config',
  'metro-transform-worker',
  'miniflare',
  'nanoid',
  'onnxruntime-node',
  'postcss',
  'sharp',
  'shell-quote',
  'undici',
  'viem',
  'ws',
]);
const KNOWN_HIGH_ADVISORIES = new Set([
  // Reviewed 2026-09-22: every id below is a high advisory npm audit still
  // reports after that review, on a chain docs/security/dependency-audit.md
  // accepts. Ids that a fix removed were dropped with it, so a regression
  // that brings one back fails the gate instead of inheriting the exception.
  1123259, 1123686, 1123896, 1123897, 1123898, 1123944, 1124066, 1124252,
  1130588, 1130589, 1130591, 1130718, 1130734, 1130736, 1130737, 1138808,
  1138809, 1139427, 1139510, 1193725, 1239030,
]);

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
for (const [name, finding] of Object.entries(report.vulnerabilities ?? {})) {
  if (finding.severity === 'critical') critical.push(name);
  if (finding.severity === 'high' && !KNOWN_HIGH_PACKAGES.has(name)) {
    unexpectedPackages.push(name);
  }
  for (const via of finding.via ?? []) {
    if (typeof via !== 'object' || via.severity !== 'high') continue;
    if (!KNOWN_HIGH_ADVISORIES.has(via.source)) {
      unexpectedAdvisories.push(`${name}: ${via.url ?? via.source}`);
    }
  }
}

const today = new Date().toISOString().slice(0, 10);
console.log(`npm audit: ${report.metadata?.vulnerabilities?.high ?? 0} high, ${report.metadata?.vulnerabilities?.critical ?? 0} critical`);
if (critical.length || unexpectedPackages.length || unexpectedAdvisories.length || today > REVIEW_BY) {
  if (critical.length) console.error(`Critical vulnerabilities: ${critical.join(', ')}`);
  if (unexpectedPackages.length) console.error(`New high-risk packages: ${unexpectedPackages.join(', ')}`);
  if (unexpectedAdvisories.length) console.error(`New high-risk advisories: ${unexpectedAdvisories.join(', ')}`);
  if (today > REVIEW_BY) console.error(`The accepted audit baseline expired on ${REVIEW_BY}.`);
  process.exit(1);
}
