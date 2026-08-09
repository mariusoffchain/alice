const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', '..', '..', 'packages', 'alice-ai', 'src', 'ai-system-prompt.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function localRequire(moduleName) {
  if (moduleName === '@alice-wallet/alice-content' || moduleName === '../constants/prompts') {
    return { BITCOIN_SYSTEM_PROMPT: 'Base Alice prompt' };
  }
  return require(moduleName);
}

const moduleShim = { exports: {} };
new Function('exports', 'module', 'require', compiled)(moduleShim.exports, moduleShim, localRequire);

const {
  applyAliceResponseConstraints,
  requiresBufferedAliceResponse,
} = moduleShim.exports;

const cases = [
  {
    name: 'French one sentence instruction',
    instructions: 'Réponds en une seule phrase.',
    response: 'Bitcoin est une monnaie numérique décentralisée. Elle fonctionne sans banque.',
    expected: 'Bitcoin est une monnaie numérique décentralisée.',
  },
  {
    name: 'French numeric one sentence instruction',
    instructions: 'Réponds en 1 phrase max.',
    response: 'Bitcoin est rare. Il est limité à 21 millions.',
    expected: 'Bitcoin est rare.',
  },
  {
    name: 'English one sentence instruction',
    instructions: 'Answer in one sentence.',
    response: 'Bitcoin is a decentralized monetary network. It has no central issuer.',
    expected: 'Bitcoin is a decentralized monetary network.',
  },
  {
    name: 'Bullet cleanup',
    instructions: 'one sentence only',
    response: '- Bitcoin lets users transfer value without a central issuer. It uses proof of work.',
    expected: 'Bitcoin lets users transfer value without a central issuer.',
  },
  {
    name: 'No constraint leaves response unchanged',
    instructions: 'Be concise.',
    response: 'Bitcoin is a network. It is also an asset.',
    expected: 'Bitcoin is a network. It is also an asset.',
  },
];

let failures = 0;

for (const testCase of cases) {
  const actual = applyAliceResponseConstraints(testCase.instructions, testCase.response);
  const shouldBuffer = requiresBufferedAliceResponse(testCase.instructions);
  const expectedBuffer = testCase.name !== 'No constraint leaves response unchanged';

  if (actual !== testCase.expected || shouldBuffer !== expectedBuffer) {
    failures += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(`  expected: ${testCase.expected}`);
    console.error(`  actual:   ${actual}`);
    console.error(`  expected buffer: ${expectedBuffer}`);
    console.error(`  actual buffer:   ${shouldBuffer}`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log('AI system prompt checks passed.');
}
