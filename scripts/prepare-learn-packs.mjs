import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Makes the embedded Learn packs present before app-web is built.
//
// Two families of packs exist, and only one of them can be regenerated on a
// build machine:
//  - the EMBEDDED languages (LEARN_EMBED_LANGS in the generated catalog) are
//    served from the app itself, at /learn/<lang>/..., so they must sit in
//    apps/app-web/public/learn before `next build` copies public/ into the
//    export. That directory is gitignored (437 MB locally in dev), so a fresh
//    clone has nothing, and the Learn section would ship broken for its own
//    default language;
//  - every other language, and all the cover art, is fetched at runtime from
//    the packs repository (NEXT_PUBLIC_LEARN_PACKS_BASE) and needs nothing here.
//
// Regenerating the embedded packs would mean cloning the Plan B corpus and
// re-parsing it, which a deploy has no business doing: it would also risk
// producing packs from a different corpus commit than the published ones. So
// this script DOWNLOADS them, from the very tag the app is pinned to, and
// checks that tag's manifest against the commit recorded in the catalog. Same
// bytes in the app as on the CDN, or the build fails.
//
//   node scripts/prepare-learn-packs.mjs          prepare (idempotent)
//   node scripts/prepare-learn-packs.mjs --print-base   print the pinned base
//
// Runs automatically as app-web's `prebuild`, so `npm run build` (Vercel, the
// desktop build script, or a local build) is enough.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const PUBLIC_PACKS_ROOT = path.join(REPO_ROOT, 'apps/app-web/public/learn');
const CATALOG_PATH = path.join(
  REPO_ROOT,
  'packages/alice-content/src/generated/planb-learn-catalog.ts',
);

// The one place the published packs are pinned. Bump it when a new tag is
// published (scripts/publish-learn-packs.mjs prints the reminder); the desktop
// build script and the Vercel build read it from here rather than repeating it,
// so the embedded languages and the downloaded ones can never come from two
// different generations of the corpus.
const LEARN_PACKS_BASE =
  'https://cdn.jsdelivr.net/gh/mariusoffchain/alice-learn-planb-packs@v2';

function resolvedBase() {
  return (process.env.NEXT_PUBLIC_LEARN_PACKS_BASE || LEARN_PACKS_BASE).replace(/\/+$/, '');
}

// The base is a CDN URL; the packs behind it are a public git repository, which
// is what makes downloading two directories out of 414 MB possible at all.
function gitSourceFor(base) {
  const jsdelivr = base.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)@(.+)$/);
  if (jsdelivr) {
    return { url: `https://github.com/${jsdelivr[1]}/${jsdelivr[2]}.git`, ref: jsdelivr[3] };
  }
  const raw = base.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (raw) {
    return { url: `https://github.com/${raw[1]}/${raw[2]}.git`, ref: raw[3] };
  }
  return null;
}

function readCatalogField(source, name, pattern) {
  const match = source.match(pattern);
  if (!match) {
    console.error(`${name} introuvable dans ${path.relative(REPO_ROOT, CATALOG_PATH)}.`);
    process.exit(1);
  }
  return match[1];
}

// A dev machine keeps every language under public/learn (437 MB of them), and
// `next build` copies public/ into the export wholesale. A deploy made from
// such a checkout therefore ships eight times what it needs. Vercel is safe,
// its clone is fresh, but a hand-made build is not. Warn rather than delete:
// those directories are the maintainer's, expensive to rebuild, and no build
// script should quietly destroy them.
function warnAboutExtraLanguages(embedLangs) {
  let extra;
  try {
    extra = fs.readdirSync(PUBLIC_PACKS_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'thumbs')
      .map(entry => entry.name)
      .filter(name => !embedLangs.includes(name));
  } catch {
    return;
  }
  if (extra.length === 0) return;
  console.warn(
    `\nAttention: ${extra.length} langues Learn en plus des embarquées sont présentes`
    + ` dans ${path.relative(REPO_ROOT, PUBLIC_PACKS_ROOT)}.`,
  );
  console.warn('  next build les copiera toutes dans l\'export, qui pèsera plusieurs centaines de Mo.');
  console.warn('  Sans effet sur un déploiement Vercel (clone neuf), mais un build fait ici');
  console.warn(`  et déployé à la main embarquerait: ${extra.slice(0, 8).join(', ')}${extra.length > 8 ? '...' : ''}`);
}

function main() {
  if (process.argv.includes('--print-base')) {
    console.log(resolvedBase());
    return;
  }

  const base = resolvedBase();

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`Catalogue Learn introuvable: ${path.relative(REPO_ROOT, CATALOG_PATH)}`);
    process.exit(1);
  }
  const catalog = fs.readFileSync(CATALOG_PATH, 'utf8');
  const commit = readCatalogField(catalog, 'PLANB_COMMIT', /export const PLANB_COMMIT = '([0-9a-f]{40})'/);
  const embedLangs = JSON.parse(
    readCatalogField(catalog, 'LEARN_EMBED_LANGS', /export const LEARN_EMBED_LANGS = (\[[^\]]*\])/),
  );

  // A language counts as present when its catalog.json is there: that is the
  // first file the app asks for, and the one a half-finished copy would lack.
  const missing = embedLangs.filter(
    (lang) => !fs.existsSync(path.join(PUBLIC_PACKS_ROOT, lang, 'catalog.json')),
  );
  if (missing.length === 0) {
    console.log(`Packs Learn embarqués déjà présents (${embedLangs.join(', ')}).`);
    warnAboutExtraLanguages(embedLangs);
    return;
  }

  // Escape hatch for a build with no network, where a broken Learn section is
  // a knowingly accepted outcome rather than a surprise.
  if (process.env.LEARN_PACKS_SKIP === '1') {
    console.warn(
      `LEARN_PACKS_SKIP=1: packs manquants (${missing.join(', ')}), la section Learn sera vide dans ce build.`,
    );
    return;
  }

  const source = gitSourceFor(base);
  if (!source) {
    console.error(`Base de packs non reconnue: ${base}`);
    console.error('Attendu une URL jsDelivr ou raw.githubusercontent pointant un dépôt public épinglé.');
    process.exit(1);
  }

  const tmpRoot = path.join(REPO_ROOT, 'node_modules', '.cache', 'alice-learn-packs');
  const clone = path.join(tmpRoot, 'repo');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });

  // git's own chatter is captured rather than shown: a successful download has
  // nothing to say, and its transfer counters plus the detached-HEAD notice
  // (normal when cloning a tag) read like trouble in a deploy log. On failure
  // everything it said is printed, which is when it actually helps.
  const git = (args, cwd) =>
    execFileSync('git', ['-c', 'advice.detachedHead=false', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  console.log(`Packs Learn manquants: ${missing.join(', ')}`);
  console.log(`Téléchargement depuis ${source.url} (${source.ref}), langues embarquées seulement.`);
  try {
    // Blobless + sparse: the tag holds 28 languages and 414 MB, and this pulls
    // the file contents of two directories out of it.
    git([
      'clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse',
      '--branch', source.ref, source.url, clone,
    ]);
    git(['sparse-checkout', 'set', ...embedLangs], clone);
  } catch (error) {
    console.error('Le téléchargement des packs a échoué (réseau ou tag absent).');
    console.error(`Vérifie que le tag ${source.ref} existe sur ${source.url}.`);
    const details = error?.stderr?.toString().trim();
    if (details) console.error(details);
    process.exit(1);
  }

  // The packs and the bundled catalog must describe the same corpus: a tag
  // published from another generation would list courses the catalog does not
  // know, or miss chapters it promises.
  const manifestPath = path.join(clone, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.sourceCommit !== commit) {
      console.error('Les packs publiés ne viennent pas du même corpus que le catalogue embarqué.');
      console.error(`  catalogue: ${commit}`);
      console.error(`  tag ${source.ref}: ${manifest.sourceCommit}`);
      console.error('Republie les packs (scripts/publish-learn-packs.mjs) ou avance l\'épingle.');
      process.exit(1);
    }
  } else {
    console.warn(`manifest.json absent du tag ${source.ref}: correspondance du corpus non vérifiée.`);
  }

  for (const lang of embedLangs) {
    const from = path.join(clone, lang);
    if (!fs.existsSync(path.join(from, 'catalog.json'))) {
      console.error(`La langue ${lang} est absente du tag ${source.ref}.`);
      process.exit(1);
    }
    // Staged, then moved into place: an interrupted copy must not leave a
    // half-written language that the presence check would accept next time.
    const staged = path.join(tmpRoot, `${lang}.staged`);
    const target = path.join(PUBLIC_PACKS_ROOT, lang);
    fs.rmSync(staged, { recursive: true, force: true });
    fs.cpSync(from, staged, { recursive: true });
    fs.mkdirSync(PUBLIC_PACKS_ROOT, { recursive: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staged, target);
    const files = fs.readdirSync(target, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile()).length;
    console.log(`  ${lang}: ${files} fichiers`);
  }

  fs.rmSync(clone, { recursive: true, force: true });
  console.log(`Corpus PlanB ${commit.slice(0, 8)} · les autres langues et les vignettes viennent de ${base}`);
}

main();
