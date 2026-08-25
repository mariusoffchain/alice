// Turns Alice's own public documentation into knowledge chunks, so Alice can
// answer questions about the project itself: how to report a vulnerability,
// what the licence allows, what the seed restores, how the beta channel works.
// The answers then come from the documents that ship in the repository rather
// than from the model's memory of them.
//
// The file list below is an explicit ALLOWLIST, never a glob. Documentation
// also holds maintainer material that must never reach a user's device: the
// publication runbook, the vision notes, the BTCPay operations guide. A glob
// would swallow those the day someone adds one; an allowlist cannot.
//
//   node scripts/build-docs-rag.js
//
// Output: packages/alice-ai/src/generated/docs-rag.ts
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'packages/alice-ai/src/generated/docs-rag.ts');

// Every entry is public: it survives the publication export and
// contains no credential, no infrastructure identifier and no internal plan.
// `weight` is the retrieval weight: project documentation must never outrank
// Bitcoin knowledge on a Bitcoin question, so it sits below the core's own.
const DOCS = [
  { file: 'README.md', topic: 'alice_project', weight: 80 },
  { file: 'SECURITY.md', topic: 'alice_security', weight: 85 },
  { file: 'CONTRIBUTING.md', topic: 'alice_project', weight: 75 },
  { file: 'BUILDING.md', topic: 'alice_project', weight: 70 },
  { file: 'TRADEMARKS.md', topic: 'alice_project', weight: 70 },
  { file: 'docs/BETA_TESTING.md', topic: 'alice_beta', weight: 85 },
  { file: 'docs/wallet-data-and-recovery.md', topic: 'alice_wallet_data', weight: 90 },
  { file: 'docs/billing-and-quotas.md', topic: 'alice_billing', weight: 85 },
  { file: 'docs/ALICE_ACCOUNT_PASSWORDS.md', topic: 'alice_account', weight: 85 },
  { file: 'docs/test-wallet-faucet.md', topic: 'alice_playground', weight: 80 },
  { file: 'docs/security/THREAT_MODEL.md', topic: 'alice_security', weight: 85 },
  { file: 'docs/security/private-cloud-e2ee.md', topic: 'alice_security', weight: 85 },
  { file: 'docs/security/local-chat-encryption.md', topic: 'alice_security', weight: 85 },
  { file: 'docs/security/recovery-bundle.md', topic: 'alice_wallet_data', weight: 85 },
];

// The documents are written in English and stay that way: they are the
// repository's own files, and translating them would fork the truth. But
// keyword retrieval does not cross languages, so a French question would
// never reach them. Each topic therefore carries the French words a French
// question actually uses. Measured before adding this: "comment signaler une
// faille de securite" retrieved the README preamble instead of SECURITY.md.
const FRENCH_KEYWORDS_BY_TOPIC = {
  alice_project: ['projet alice', 'code source alice', 'licence alice', 'contribuer a alice', 'depot github alice', 'open source'],
  alice_security: ['securite alice', 'signaler une faille', 'signaler une vulnerabilite', 'faille de securite', 'divulgation responsable', 'modele de menace', 'chiffrement de bout en bout'],
  alice_beta: ['beta alice', 'tester alice', 'programme de test', 'version beta', 'apk beta'],
  alice_wallet_data: ['recuperation du wallet', 'restaurer mon wallet', 'que restaure la seed', 'perdre mes donnees', 'sauvegarde du wallet', 'reinitialiser alice'],
  alice_billing: ['facturation alice', 'quota alice', 'requetes gratuites', 'prix alice', 'abonnement alice', 'payer alice'],
  alice_account: ['compte alice', 'mot de passe alice', 'identifiants alice', 'creer un compte', 'se connecter a alice'],
  alice_playground: ['playground alice', 'wallet d entrainement', 'sats d entrainement', 'faucet alice', 'robinet mutinynet'],
};

// A handful of sections answer a question people ask by name, and the topic
// table is too coarse to reach them: it lands on the document's opening block
// instead, which does not carry the address or the licence name. Keyed on the
// exact heading, so a renamed section drops out of this table rather than
// silently pointing at the wrong text.
const FRENCH_KEYWORDS_BY_SECTION = {
  'Reporting Security Issues': ['signaler une faille', 'signaler un bug de securite', 'contacter la securite', 'ou signaler', 'a qui signaler'],
  License: ['licence', 'sous quelle licence', 'agpl', 'droit d auteur', 'puis-je reutiliser le code'],
  'Sensitive Data Rules': ['donnees sensibles', 'ce qu alice ne demande jamais', 'ne jamais partager'],
  'AI / Wallet Isolation': ['separation ia wallet', 'l ia peut-elle depenser', 'frontiere ia wallet'],
  'What Alice can never see': ['ce qu alice ne voit jamais', 'quelles donnees sont collectees', 'vie privee alice'],
};

// Sections that describe how to operate Alice's own infrastructure, not how
// to use or audit her. They are public, but useless to a user and noisy in
// retrieval.
const SKIP_HEADINGS = /^(deploy|deployment|operations|ops runbook|release checklist|internal)/i;

const MIN_CHUNK_CHARS = 180;
const MAX_CHUNK_CHARS = 1400;

function slug(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function sourceHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

/** Markdown to plain prose: retrieval reads sentences, not syntax. */
function toProse(markdown) {
  return markdown
    // Fenced code blocks are commands, not knowledge: a shell line retrieved
    // mid-answer reads as an instruction Alice is telling the user to run.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One chunk per H2 section, which is how these documents are written. */
function sectionsOf(markdown, docTitle) {
  const lines = markdown.split('\n');
  const sections = [];
  let heading = null;
  let buffer = [];
  let inFence = false;

  const flush = () => {
    if (!heading) { buffer = []; return; }
    const prose = toProse(buffer.join('\n'));
    if (prose.length >= MIN_CHUNK_CHARS && !SKIP_HEADINGS.test(heading)) {
      sections.push({ heading, prose: prose.slice(0, MAX_CHUNK_CHARS) });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h2 = !inFence && line.match(/^##\s+(?!#)\s*(.+?)\s*$/);
    if (h2) {
      flush();
      heading = h2[1];
      continue;
    }
    if (heading) buffer.push(line);
  }
  flush();

  // The preamble before the first H2 is the document's own summary, and for
  // README it is the best "what is Alice" passage in the repository.
  const preamble = toProse(lines.slice(0, lines.findIndex(l => /^##\s/.test(l)) + 1 || lines.length).join('\n'));
  if (preamble.length >= MIN_CHUNK_CHARS) {
    sections.unshift({ heading: docTitle, prose: preamble.slice(0, MAX_CHUNK_CHARS) });
  }
  return sections;
}

function escapeTsString(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const chunks = [];
const missing = [];

for (const doc of DOCS) {
  const absolute = path.join(REPO_ROOT, doc.file);
  if (!fs.existsSync(absolute)) {
    missing.push(doc.file);
    continue;
  }
  const markdown = fs.readFileSync(absolute, 'utf8');
  const docTitle = (markdown.match(/^#\s+(.+)$/m) ?? [, path.basename(doc.file, '.md')])[1].trim();
  const sections = sectionsOf(markdown, docTitle);
  // Whichever block opens the document carries the French keywords: its
  // summary when there is one, otherwise its first section. SECURITY.md
  // opens with a single sentence, too short to become a summary chunk, and
  // targeting summaries alone left it unreachable in French.
  const frenchCarrier = sections[0]?.heading;
  for (const section of sections) {
    const id = `docs-${slug(doc.file.replace(/\.md$/, ''))}__${slug(section.heading)}`;
    chunks.push({
      id,
      conceptId: id,
      title: section.heading === docTitle ? docTitle : `${docTitle}: ${section.heading}`,
      // English keywords stay derived from the document itself. The French
      // ones go on the document's opening section ONLY: given to every
      // section they made a whole document surface at once on any French
      // question, evicting the short core entry that answered it better
      // (measured: "dois-je creer un compte" returned three pages of
      // password internals instead of the one-paragraph answer). On the
      // summary alone, a French question reaches the right document at the
      // right altitude, and English questions still reach a precise section.
      keywords: [...new Set([
        docTitle.toLowerCase(),
        section.heading.toLowerCase(),
        'alice documentation',
        'documentation alice',
        ...(section.heading === frenchCarrier ? FRENCH_KEYWORDS_BY_TOPIC[doc.topic] ?? [] : []),
        ...(FRENCH_KEYWORDS_BY_SECTION[section.heading] ?? []),
      ])],
      level: 'beginner',
      content: section.prose,
      topic: doc.topic,
      retrievalWeight: doc.weight,
      sourcePath: doc.file,
      sourceHash: sourceHash(section.prose),
    });
  }
}

const lines = [];
lines.push("// Generated by scripts/build-docs-rag.js from Alice's public documentation.");
lines.push('// Do not edit by hand; regenerate with node scripts/build-docs-rag.js');
lines.push('// The source files are listed explicitly in that script (allowlist).');
lines.push('');
lines.push("import type { KnowledgeChunk } from '../knowledge-packs';");
lines.push('');
lines.push('export const GENERATED_DOCS_KNOWLEDGE_BASE: readonly KnowledgeChunk[] = [');
for (const chunk of chunks) {
  lines.push('  {');
  lines.push(`    id: '${chunk.id}',`);
  lines.push(`    conceptId: '${chunk.conceptId}',`);
  lines.push(`    title: '${escapeTsString(chunk.title)}',`);
  lines.push(`    keywords: [${chunk.keywords.map(k => `'${escapeTsString(k)}'`).join(', ')}],`);
  lines.push(`    level: 'beginner',`);
  lines.push(`    content: '${escapeTsString(chunk.content)}',`);
  lines.push(`    theme: '${chunk.topic}',`);
  lines.push(`    retrievalWeight: ${chunk.retrievalWeight},`);
  lines.push(`    sourcePath: '${escapeTsString(chunk.sourcePath)}',`);
  lines.push(`    locale: 'en',`);
  lines.push(`    sourceLocale: 'en',`);
  lines.push(`    translationStatus: 'source',`);
  lines.push(`    sourceHash: '${chunk.sourceHash}',`);
  lines.push('  },');
}
lines.push('];');
lines.push('');

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, lines.join('\n'));

console.log(`Generated ${chunks.length} documentation chunks from ${DOCS.length - missing.length} files.`);
const perDoc = {};
for (const chunk of chunks) perDoc[chunk.sourcePath] = (perDoc[chunk.sourcePath] ?? 0) + 1;
for (const [file, count] of Object.entries(perDoc)) console.log(`  ${count.toString().padStart(3)}  ${file}`);
if (missing.length > 0) console.warn(`\nMissing from the allowlist: ${missing.join(', ')}`);
console.log(`\n→ ${path.relative(REPO_ROOT, OUTPUT_PATH)}`);
