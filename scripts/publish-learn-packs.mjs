import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Assembles the alice-learn-planb-packs repository content: the generated
// Learn packs for every language, plus the attribution the licence requires.
// The app ships English and French; the 27 other languages and all the cover
// art are fetched from this repo (see apps/app-web/src/lib/learn/packs-base.ts),
// and the embedded pair is downloaded from the published tag at build time
// (scripts/prepare-learn-packs.mjs), so both halves come from one generation.
//
// Run scripts/build-planb-learn.mjs first, then:
//   node scripts/publish-learn-packs.mjs [--out <dir>]
// Nothing is pushed: the script prepares a directory and prints the commands.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const PACKS_ROOT = path.join(REPO_ROOT, 'packages/alice-content/generated/learn');
const CATALOG_PATH = path.join(REPO_ROOT, 'packages/alice-content/src/generated/planb-learn-catalog.ts');

const REPO_NAME = 'alice-learn-planb-packs';
const OWNER = 'mariusoffchain';
const outFlag = process.argv.indexOf('--out');
const OUT_DIR = outFlag !== -1 && process.argv[outFlag + 1]
  ? path.resolve(process.argv[outFlag + 1])
  : path.join(REPO_ROOT, 'dist', REPO_NAME);

if (!fs.existsSync(PACKS_ROOT)) {
  console.error(`No packs found in ${path.relative(REPO_ROOT, PACKS_ROOT)}.`);
  console.error('Lance d\'abord: PLANB_CONTENT_ROOT=<clone> node scripts/build-planb-learn.mjs');
  process.exit(1);
}

// The corpus commit the packs were generated from, read back from the catalog
// rather than re-derived: what is published must name the exact source.
const catalog = fs.readFileSync(CATALOG_PATH, 'utf8');
const commit = catalog.match(/export const PLANB_COMMIT = '([0-9a-f]{40})'/)?.[1];
if (!commit) {
  console.error('PLANB_COMMIT is missing from the generated catalogue.');
  process.exit(1);
}

// `thumbs` sits beside the language directories but is not one: it is the
// shared cover art. Listing it as a language would put a lie in the manifest.
const THUMBS_DIR = 'thumbs';
const langs = fs
  .readdirSync(PACKS_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== THUMBS_DIR)
  .map((e) => e.name)
  .sort();

function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) n += 1;
  }
  return n;
}

function dirSizeMo(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath ?? entry.path, entry.name)).size;
  }
  return total / 1024 / 1024;
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const lang of langs) {
  fs.cpSync(path.join(PACKS_ROOT, lang), path.join(OUT_DIR, lang), { recursive: true });
}
if (fs.existsSync(path.join(PACKS_ROOT, THUMBS_DIR))) {
  fs.cpSync(path.join(PACKS_ROOT, THUMBS_DIR), path.join(OUT_DIR, THUMBS_DIR), { recursive: true });
}

const totalMo = dirSizeMo(OUT_DIR);
const manifest = {
  generator: 'alice-wallet/scripts/build-planb-learn.mjs',
  source: 'https://github.com/PlanB-Network/bitcoin-educational-content',
  sourceCommit: commit,
  license: 'CC BY-SA 4.0',
  languages: langs,
  files: countFiles(OUT_DIR),
  megabytes: Number(totalMo.toFixed(1)),
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Attribution is not decoration here: CC BY-SA requires naming the author, the
// licence, and the changes made. These packs ARE a derivative work.
fs.writeFileSync(
  path.join(OUT_DIR, 'README.md'),
  `# ${REPO_NAME}

Reading packs for the Learn section of [Alice](https://github.com/${OWNER}/alice):
the Plan \u20BF Network educational corpus, reshaped into per-language JSON files
the app fetches chapter by chapter.

## Licence and attribution

The content of this repository is **not ours**. It comes from
**[Plan \u20BF Network](https://planb.network)**, from the repository
[bitcoin-educational-content](https://github.com/PlanB-Network/bitcoin-educational-content)
at commit \`${commit}\`, which is licensed
**[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**
([their licence file](https://github.com/PlanB-Network/bitcoin-educational-content/blob/${commit}/LICENSE.md)).

That licence allows anyone to share and adapt the material, for any purpose,
under three conditions, which this repository meets:

1. **Attribution**, Plan \u20BF Network is credited here, in every generated
   pack (each file carries the source commit), in the Learn welcome dialog and
   at the foot of every course inside the app.
2. **Indicate changes**, **yes, changes were made**, and only of one kind:
   *format*. The original Markdown and YAML were parsed into JSON. Courses were
   split into parts and chapters keyed by the corpus' own stable identifiers,
   quizzes were assembled per course, metadata was extracted per language.
   **No teaching text was rewritten, shortened, summarised, reordered or
   translated by us**, and no text was generated by a language model. Course
   images are not copied at all: the packs point back at the source repository
   at the same pinned commit.
3. **ShareAlike**, everything here is distributed under CC BY-SA 4.0, the very
   same licence, as the LICENSE file states.

The software that produced these files is a separate work, lives in the Alice
repository, and carries its own licence.

## Why this repository exists

The app could read Plan \u20BF Network's repository directly, and for course text
alone that would work. Two things make the pre-assembled packs the better fit:

- **The quiz layout.** Questions live in 3,045 separate folders, one file per
  question and per language, and the question-to-chapter mapping sits inside
  each folder. Opening a single course's quiz would mean hundreds of requests.
  Assembling them once, at build time, turns that into one file.
- **Reading offline, and stability.** A reader who installed a language should
  keep it when the network is gone, and a course should not stop rendering
  because an upstream file moved. Packs are pinned to one corpus commit and
  regenerated deliberately.

Keeping them in a repository of their own also keeps the app's repository small:
a corpus refresh regenerates every file, and git never forgets.

## Layout

\`\`\`
<lang>/catalog.json                     translated course/tutorial metadata
<lang>/courses/<code>.json              parts, chapters, markdown
<lang>/quizzes/<code>.json              quiz questions for the course
<lang>/tutorials/<category>/<slug>.json tutorials
\`\`\`

${langs.length} languages, ${manifest.files} files, ${manifest.megabytes} MB.
\`manifest.json\` records the exact source commit.

## Serving

Tag a release, then point the app at it:

\`\`\`
NEXT_PUBLIC_LEARN_PACKS_BASE=https://cdn.jsdelivr.net/gh/${OWNER}/${REPO_NAME}@<tag>
\`\`\`

A pinned tag matters: it keeps a reader's language stable and lets jsDelivr
cache it. Raw GitHub URLs work too
(\`https://raw.githubusercontent.com/${OWNER}/${REPO_NAME}/<tag>\`) but are
rate-limited and uncached.

## Regenerating

From the Alice repository, with a clone of the corpus:

\`\`\`bash
PLANB_CONTENT_ROOT=<clone> node scripts/build-planb-learn.mjs
node scripts/publish-learn-packs.mjs
\`\`\`

Then publish as a new tag and move the app to it. Each generation replaces the
previous one; the history is not kept, so the repository stays flat.
`,
);

fs.writeFileSync(
  path.join(OUT_DIR, 'LICENSE'),
  `The content of this repository is a derivative work of the Plan B Network
educational corpus (https://github.com/PlanB-Network/bitcoin-educational-content),
commit ${commit}, and is distributed under the same licence:

Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
https://creativecommons.org/licenses/by-sa/4.0/legalcode

You are free to share and adapt this material, for any purpose, provided you
give appropriate credit to Plan B Network, indicate whether changes were made,
and distribute your contributions under the same licence.
`,
);

const rel = path.relative(REPO_ROOT, OUT_DIR);
console.log(`Ready: ${rel}`);
console.log(`Languages: ${langs.length} · Files: ${manifest.files} · Size: ${manifest.megabytes} MB`);
console.log(`Plan B corpus: ${commit.slice(0, 8)}`);
console.log('');
console.log('Left to do (this script pushes nothing):');
console.log(`  1. The PUBLIC repository ${OWNER}/${REPO_NAME} must exist on GitHub (jsDelivr requires public).`);
console.log(`  2. cd ${rel} && git init -b main && git add -A`);
console.log(`     git commit -m "Learn packs, Plan B corpus ${commit.slice(0, 8)}, CC BY-SA 4.0"`);
console.log(`     git tag v<N+1> && git remote add origin https://github.com/${OWNER}/${REPO_NAME}.git`);
console.log('     git push --force origin main && git push origin v<N+1>');
console.log('     (main is overwritten, flat by design; older tags keep being served.)');
console.log('  3. Move the pin, in one place only:');
console.log('     scripts/prepare-learn-packs.mjs → LEARN_PACKS_BASE');
console.log(`     = https://cdn.jsdelivr.net/gh/${OWNER}/${REPO_NAME}@v<N+1>`);
console.log('     (the desktop build and the Vercel build read it from there; the embedded');
console.log('     languages are downloaded from that same tag at build time.)');

try {
  execSync('git --version', { stdio: 'ignore' });
} catch {
  console.log('\n(git is not in PATH, so run the commands above elsewhere.)');
}
