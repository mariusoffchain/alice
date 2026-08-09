// Publishes a knowledge pack JSON file as a GitHub Release asset on this
// repo and prints the exact PackDescriptor entry to paste into
// packages/alice-ai/src/knowledge-pack-catalog.ts.
//
// Usage: node scripts/publish-knowledge-pack.js <path-to-pack.json> [--title "..."] [--description "..."]
//
// Requires the GitHub CLI (`gh`) authenticated with `repo` scope.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function main() {
  const [packPath, ...rest] = process.argv.slice(2);
  if (!packPath) fail('Usage: node scripts/publish-knowledge-pack.js <path-to-pack.json> [--title "..."] [--description "..."]');

  const titleIndex = rest.indexOf('--title');
  const descriptionIndex = rest.indexOf('--description');
  const title = titleIndex >= 0 ? rest[titleIndex + 1] : null;
  const description = descriptionIndex >= 0 ? rest[descriptionIndex + 1] : null;

  const absolutePath = path.resolve(packPath);
  if (!fs.existsSync(absolutePath)) fail(`Pack file not found: ${absolutePath}`);

  const bytes = fs.readFileSync(absolutePath);
  const pack = JSON.parse(bytes.toString('utf8'));
  if (!pack.id || !pack.version || !Array.isArray(pack.chunks)) {
    fail('Pack file must have id, version, and chunks.');
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const tag = `knowledge-pack-${pack.id}-v${pack.version}`;
  const assetName = `${pack.id}.json`;
  const repoRoot = run('git', ['rev-parse', '--show-toplevel']);
  const repoSlug = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);

  const existingTags = run('git', ['tag', '-l', tag]);
  if (existingTags === tag) {
    fail(`Tag ${tag} already exists. Bump the pack's "version" field before republishing.`);
  }

  console.log(`Publishing ${pack.id} v${pack.version} (${bytes.length} bytes) as release ${tag} on ${repoSlug}...`);

  run('gh', [
    'release', 'create', tag,
    absolutePath + '#' + assetName,
    '--repo', repoSlug,
    '--title', title || `Knowledge pack: ${pack.id} v${pack.version}`,
    '--notes', description || `Auto-published knowledge pack "${pack.id}", version ${pack.version}.`,
  ]);

  const url = `https://github.com/${repoSlug}/releases/download/${tag}/${assetName}`;

  console.log('\nPublished. Catalog entry:\n');
  console.log(JSON.stringify({
    id: pack.id,
    title: title || pack.id,
    description: description || '',
    sizeBytes: bytes.length,
    language: pack.language || 'multi',
    version: pack.version,
    url,
    sha256,
  }, null, 2));

  console.log(`\nNote: this asset is only publicly downloadable while ${repoSlug} is public.`);
  console.log(`Pack source kept at ${path.relative(repoRoot, absolutePath)} for future versions.`);
}

main();
