// One-off Phase 2 tool: scans the Obsidian source folders already trusted by
// the manifest for notes that follow the same Summary/Key Points template but
// are not yet imported, and appends manifest entries for them. Safe to rerun:
// files already present (by vault_relative_path) are always skipped.
const fs = require('fs');
const path = require('path');

// The corpus source vault is maintainer-local and never ships with the repo.
// Point ALICE_VAULT_ROOT at your own vault to regenerate the manifest.
const VAULT_ROOT = process.env.ALICE_VAULT_ROOT;
if (!VAULT_ROOT) {
  console.error('Set ALICE_VAULT_ROOT to the Obsidian vault that holds the Alice corpus.');
  process.exit(1);
}
const MANIFEST_PATH = path.join(VAULT_ROOT, '10 Projects/Alice Bitcoin/Resources/alice-corpus-import-manifest.json');

const SOURCE_FOLDERS = [
  '30 Knowledge/Bitcoin',
  '30 Knowledge/Privacy',
  '30 Knowledge/Economics',
  '30 Knowledge/Ark',
  '30 Knowledge/Lightning',
  '30 Knowledge/Stablecoins',
];

const SECTION_RE = /^##\s+(Summary|Résumé)\s*$/m;

const SUBFOLDER_THEME = {
  'Bitcoin/Fundamentals': 'bitcoin_basics',
  'Bitcoin/Payments': 'tx_model',
  'Bitcoin/Script and Addresses': 'addresses',
  'Bitcoin/Exchanges': 'custody',
  'Bitcoin/Security': 'safety',
  'Bitcoin/Nodes': 'nodes',
  'Bitcoin/Cryptography': 'dev_fundamentals',
  'Bitcoin/Development': 'dev_fundamentals',
  'Bitcoin/Network': 'nodes',
  'Bitcoin/Business': 'economics',
  'Bitcoin/Liquid': 'advanced_wallet',
  'Bitcoin/RGB': 'advanced_wallet',
  'Bitcoin/Mining': 'mining',
  'Bitcoin/Taproot Assets': 'advanced_wallet',
  'Bitcoin/Scaling': 'tx_model',
  'Bitcoin/People': 'history',
  'Bitcoin/History': 'history',
  'Bitcoin/Wallets': 'self_custody',
  'Bitcoin/Glossary FR-EN': 'bitcoin_basics',
  'Bitcoin/Regulation': 'politics',
  'Bitcoin/Community': 'social_utility',
  'Bitcoin/Companies': 'economics',
  'Bitcoin/Spark': 'advanced_wallet',
  'Lightning/Development': 'dev_fundamentals',
  'Lightning/Node Operations': 'nodes',
};

const TOP_FOLDER_THEME = {
  Bitcoin: 'bitcoin_basics',
  Privacy: 'privacy',
  Economics: 'economics',
  Ark: 'arkade',
  Lightning: 'lightning',
  Stablecoins: 'economics',
};

const DEFAULT_RETRIEVAL_WEIGHT = 55;

function inferTheme(relativePathInsideSource, topFolder) {
  const parts = relativePathInsideSource.split(path.sep);
  if (parts.length > 1) {
    const subfolderKey = `${topFolder}/${parts[0]}`;
    if (SUBFOLDER_THEME[subfolderKey]) return SUBFOLDER_THEME[subfolderKey];
  }
  return TOP_FOLDER_THEME[topFolder] ?? 'bitcoin_basics';
}

function slugify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const existingPaths = new Set(manifest.entries.map(e => e.vault_relative_path));
  const existingIds = new Set(manifest.entries.map(e => e.id));

  const newEntries = [];

  for (const folder of SOURCE_FOLDERS) {
    const absFolder = path.join(VAULT_ROOT, folder);
    if (!fs.existsSync(absFolder)) continue;
    const topFolder = folder.split('/').pop();

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs);
          continue;
        }
        if (!entry.name.endsWith('.md')) continue;

        const relFromVault = path.relative(VAULT_ROOT, abs);
        if (existingPaths.has(relFromVault)) continue;

        let content;
        try {
          content = fs.readFileSync(abs, 'utf8');
        } catch {
          continue;
        }
        if (!SECTION_RE.test(content)) continue;

        const relInsideSource = path.relative(absFolder, abs);
        const theme = inferTheme(relInsideSource, topFolder);
        const baseSlug = slugify(path.basename(entry.name, '.md'));
        let id = `${topFolder.toLowerCase()}__${baseSlug}`;
        let suffix = 2;
        while (existingIds.has(id)) {
          id = `${topFolder.toLowerCase()}__${baseSlug}-${suffix}`;
          suffix += 1;
        }
        existingIds.add(id);
        existingPaths.add(relFromVault);

        newEntries.push({
          id,
          phase: 2,
          priority: 'p2',
          status: 'secondaire',
          surface: 'all',
          theme,
          source_kind: 'knowledge_vault',
          path: abs,
          vault_relative_path: relFromVault,
          retrieval_weight: DEFAULT_RETRIEVAL_WEIGHT,
          chunk_strategy: 'summary_first',
          include_in_initial_rollout: true,
        });
      }
    };
    walk(absFolder);
  }

  manifest.entries.push(...newEntries);
  manifest.total_entries = manifest.entries.length;
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Added ${newEntries.length} new manifest entries (total now ${manifest.entries.length}).`);
  const byTheme = {};
  for (const e of newEntries) byTheme[e.theme] = (byTheme[e.theme] ?? 0) + 1;
  console.log('By theme:', byTheme);
}

main();
