const fs = require('fs');
const path = require('path');

const MONOREPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const AI_DIR = path.join(MONOREPO_ROOT, 'packages', 'alice-ai', 'src');
const WALLET_DIR = path.join(MONOREPO_ROOT, 'packages', 'wallet-core', 'src');

function listFiles(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
}

const WALLET_IMPORTS_FORBIDDEN_IN_AI = [
  '@alice-wallet/wallet-core',
  'expo-sqlite',
  '@arkade-os/sdk',
  '@arkade-os/boltz-swap',
];

const AI_IMPORTS_FORBIDDEN_IN_WALLET = [
  '@alice-wallet/alice-ai',
];

function importsFrom(source) {
  const imports = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) imports.push(match[1]);
  }

  return imports;
}

function checkFiles(dir, files, forbidden, label) {
  const violations = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const imports = importsFrom(source);
    for (const importPath of imports) {
      if (forbidden.some(blocked => importPath === blocked || importPath.startsWith(`${blocked}/`))) {
        violations.push(`${file} imports ${importPath}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n${label}`);
    for (const violation of violations) console.error(`- ${violation}`);
  }

  return violations.length;
}

const violations =
  checkFiles(AI_DIR, listFiles(AI_DIR), WALLET_IMPORTS_FORBIDDEN_IN_AI, 'AI core must not import wallet custody or payment modules.') +
  checkFiles(WALLET_DIR, listFiles(WALLET_DIR), AI_IMPORTS_FORBIDDEN_IN_WALLET, 'Wallet core must not import AI or chat modules.');

if (violations > 0) {
  console.error(`\nBoundary check failed with ${violations} violation${violations === 1 ? '' : 's'}.`);
  process.exit(1);
}

console.log('AI/wallet boundary check passed.');
