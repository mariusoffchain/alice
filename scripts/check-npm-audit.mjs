#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const REVIEW_BY = '2026-09-08';
const KNOWN_HIGH_PACKAGES = new Set([
  // Reviewed 2026-08-09 — see docs/security/dependency-audit.md for the
  // per-chain exposure rationale behind every entry.
  '@expo/cli',
  '@expo/metro',
  '@expo/metro-config',
  '@huggingface/transformers',
  '@lendasat/lendaswap-sdk-pure',
  '@react-native/community-cli-plugin',
  '@satora/swap',
  'adm-zip',
  'brace-expansion',
  'expo',
  'fast-uri',
  'image-size',
  'js-yaml',
  'metro',
  'metro-config',
  'metro-transform-worker',
  'nanoid',
  'next',
  'onnxruntime-node',
  'postcss',
  'react-native',
  'sharp',
  'shell-quote',
  'undici',
  'viem',
  'ws',
]);
const KNOWN_HIGH_ADVISORIES = new Set([
  1123686, 1123896, 1123897, 1123898, 1130588, 1130589, 1130591, 1130734,
  1130736, 1130737, 1124064, 1130720, 1136581, 1123911, 1123912, 1124252,
  1124288, 1124066, 1123944, 1130718, 1123259,
  // Added 2026-08-09:
  1138395, // fast-uri host confusion — reached only by ajv inside expo-build-properties (prebuild)
  1138808, 1138809, // image-size ICNS/JXL DoS — Metro build-time asset probing of our own assets
  1138114, 1138115, // js-yaml !!omap quadratic — @expo/xcpretty and babel-jest, build/test only
  1138813, // nanoid custom-generator loop — we only reach standard nanoid() via postcss/expo-router
  // Added 2026-08-16. New advisories published against packages already in the
  // reviewed baseline; no new dependency introduced them.
  1144861, // fast-uri IDN canonicalization host confusion — same ajv chain as 1138395, prebuild and dev-client only
  1139427, // nanoid zero-size generator loop — ships via expo-router, but the size argument is never attacker-reachable
  1139510, // postcss sourceMappingURL path traversal — same family as 1124252/1130709, build-time only on our own CSS
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
