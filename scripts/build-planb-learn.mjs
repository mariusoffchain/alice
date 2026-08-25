import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// The PlanB corpus clone is maintainer-local and never ships with the repo,
// same model as the Obsidian vault for build-obsidian-rag.js. Point
// PLANB_CONTENT_ROOT at a clone of PlanB-Network/bitcoin-educational-content
// (a sparse text-only clone is enough; media assets are never read).
const CONTENT_ROOT = process.env.PLANB_CONTENT_ROOT;
if (!CONTENT_ROOT || !fs.existsSync(path.join(CONTENT_ROOT, 'courses'))) {
  console.error('Set PLANB_CONTENT_ROOT to a clone of PlanB-Network/bitcoin-educational-content.');
  process.exit(1);
}

const require = createRequire(import.meta.url);
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  console.error('js-yaml is not resolvable from the workspace; run npm install first.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(REPO_ROOT, 'packages/alice-content/src/generated/planb-learn-catalog.ts');
const PACKS_ROOT = path.join(REPO_ROOT, 'packages/alice-content/generated/learn');
// app-web loads packs by fetch('/learn/...'), the same mechanism as
// /core-embeddings, which works identically in the browser and in the
// Tauri webview (origin 'self'). The copy is gitignored on both sides.
const PUBLIC_PACKS_ROOT = path.join(REPO_ROOT, 'apps/app-web/public/learn');

// Languages whose text ships inside the app rather than being fetched from the
// remote base: the 29 languages weigh 437 Mo of JSON, one weighs ~14 Mo, and a
// reader only ever needs their own. English and French cover the launch
// audience for about 29 Mo, which a build carries without trouble. Every other
// whitelisted language is listed in the catalog as available and fetched from
// the remote base (apps/app-web/src/lib/learn/packs-base.ts), so the picker
// only offers what is actually reachable. Changing this list changes what a
// build must carry: scripts/prepare-learn-packs.mjs reads it back from the
// generated catalog and downloads exactly these languages.
const EMBED_LANGS = ['en', 'fr'];
// Course/tutorial METADATA (names, goals, objectives) bundled in the TS
// catalog: 240 Ko for the pair, and it is what labels the dashboard and feeds
// the deterministic chat suggestion. Keeping French here costs nothing and
// keeps a French question matching French course titles before any download.
const CATALOG_LANGS = ['fr', 'en'];
// LEARN_PACKS_REMOTE=1 copies only the embedded language into public/: the
// rest is published separately (GitHub) and served from there. Left unset,
// every language is copied locally, which is what dev uses.
const PACKS_REMOTE = process.env.LEARN_PACKS_REMOTE === '1';
const MIN_COURSE_COVERAGE = 30;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,5})?$/;

const RAW_BASE = 'https://raw.githubusercontent.com/PlanB-Network/bitcoin-educational-content';
const commit = execSync('git rev-parse HEAD', { cwd: CONTENT_ROOT }).toString().trim();

const warnings = [];
const warn = (msg) => warnings.push(msg);

function readYaml(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    warn(`YAML invalide, ignoré: ${path.relative(CONTENT_ROOT, filePath)} (${error.message?.split('\n')[0]})`);
    return null;
  }
}

function splitFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: markdown };
  let meta = {};
  try {
    meta = yaml.load(match[1]) ?? {};
  } catch {
    warn('Frontmatter YAML invalide (conservé vide).');
  }
  return { meta, body: markdown.slice(match[0].length) };
}

function extractVideoIds(markdown) {
  return [...markdown.matchAll(/:::video\s+id=([0-9a-f-]{36})\s*:::/g)].map((m) => m[1]);
}

// A course body is: intro, then `+++`, then `# Part` blocks each holding a
// <partId> tag and `## Chapter` blocks each holding a <chapterId> tag.
// Headings are only structural outside fenced code blocks: shell comments like
// `# Find container name:` inside ``` fences must not open a new part.
function parseCourseBody(body, sourceLabel) {
  const [introRaw, ...rest] = body.split(/^\+\+\+\s*$/m);
  const main = rest.length ? rest.join('\n') : body;
  const intro = rest.length ? introRaw.trim() : '';

  const parts = [];
  let part = null;
  let chapter = null;
  let buffer = [];
  let inFence = false;

  const flushChapter = () => {
    if (!chapter) return;
    const markdown = buffer
      .join('\n')
      .replace(/<chapterId>[0-9a-f-]{36}<\/chapterId>\s*/g, '')
      .trim();
    chapter.markdown = markdown;
    chapter.videoIds = extractVideoIds(markdown);
    buffer = [];
  };

  for (const line of main.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const partHeading = !inFence && line.match(/^# (?!#)\s*(.+?)\s*$/);
    const chapterHeading = !inFence && line.match(/^## (?!#)\s*(.+?)\s*$/);
    if (partHeading) {
      flushChapter();
      chapter = null;
      part = { partId: null, title: partHeading[1], chapters: [] };
      parts.push(part);
      continue;
    }
    if (chapterHeading && part) {
      flushChapter();
      chapter = { chapterId: null, title: chapterHeading[1], videoIds: [], markdown: '' };
      part.chapters.push(chapter);
      continue;
    }
    const partId = !inFence && line.match(/<partId>([0-9a-f-]{36})<\/partId>/);
    if (partId && part && !chapter) {
      part.partId = partId[1];
      continue;
    }
    const chapterId = !inFence && line.match(/<chapterId>([0-9a-f-]{36})<\/chapterId>/);
    if (chapterId && chapter) {
      chapter.chapterId = chapterId[1];
      continue;
    }
    if (chapter) buffer.push(line);
  }
  flushChapter();

  for (const p of parts) {
    if (!p.partId) warn(`partId manquant dans ${sourceLabel} pour la partie « ${p.title} »`);
    for (const c of p.chapters) {
      if (!c.chapterId) warn(`chapterId manquant dans ${sourceLabel} pour le chapitre « ${c.title} »`);
    }
  }
  return { intro, parts };
}

function listLangFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .filter((lang) => {
      if (!LANG_RE.test(lang)) {
        // Catches the known `presentation.md` trap and any future stray file.
        warn(`Fichier ignoré (pas un code de langue): ${path.relative(CONTENT_ROOT, dir)}/${lang}.md`);
        return false;
      }
      return true;
    });
}

// ---------------------------------------------------------------- courses ---

const courseDirs = fs
  .readdirSync(path.join(CONTENT_ROOT, 'courses'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const courses = [];
const coverage = new Map();

for (const code of courseDirs) {
  const dir = path.join(CONTENT_ROOT, 'courses', code);
  const meta = readYaml(path.join(dir, 'course.yml'));
  if (!meta) continue;

  const languages = listLangFiles(dir).sort();
  for (const lang of languages) coverage.set(lang, (coverage.get(lang) ?? 0) + 1);

  const videos = {};
  for (const v of meta.videos ?? []) {
    const youtube = {};
    for (const entry of v.youtube ?? []) Object.assign(youtube, entry);
    videos[v.id] = youtube;
  }

  const i18n = {};
  const structure = {};
  for (const lang of CATALOG_LANGS) {
    const mdPath = path.join(dir, `${lang}.md`);
    if (!fs.existsSync(mdPath)) continue;
    const { meta: fm, body } = splitFrontmatter(fs.readFileSync(mdPath, 'utf8'));
    i18n[lang] = { name: fm.name ?? code, goal: fm.goal ?? '', objectives: fm.objectives ?? [] };
    structure[lang] = parseCourseBody(body, `courses/${code}/${lang}.md`);
  }

  // Quizzes: quizz/NNN/question.yml holds the language-neutral fields,
  // quizz/NNN/<lang>.yml the human-reviewed translated fields.
  const quizzes = {};
  const quizRoot = path.join(dir, 'quizz');
  if (fs.existsSync(quizRoot)) {
    for (const qdir of fs.readdirSync(quizRoot).filter((d) => /^\d+$/.test(d)).sort()) {
      const qbase = readYaml(path.join(quizRoot, qdir, 'question.yml'));
      if (!qbase?.chapterId) {
        warn(`Quiz sans chapterId: courses/${code}/quizz/${qdir}`);
        continue;
      }
      for (const lang of CATALOG_LANGS) {
        const qPath = path.join(quizRoot, qdir, `${lang}.yml`);
        if (!fs.existsSync(qPath)) continue;
        const q = readYaml(qPath);
        if (!q?.question || !q?.answer || !Array.isArray(q.wrong_answers)) continue;
        (quizzes[lang] ??= []).push({
          id: qbase.id ?? `${code}-${qdir}`,
          chapterId: qbase.chapterId,
          difficulty: qbase.difficulty ?? 'easy',
          question: q.question,
          answer: q.answer,
          wrongAnswers: q.wrong_answers,
          explanation: q.explanation ?? '',
          reviewed: q.reviewed === true,
        });
      }
    }
  }

  courses.push({
    code,
    courseId: meta.id ?? null,
    topic: meta.topic ?? 'bitcoin',
    subtopic: meta.subtopic ?? null,
    level: meta.level ?? 'beginner',
    type: meta.type ?? 'theory',
    hours: meta.hours ?? null,
    originalLanguage: meta.original_language ?? 'en',
    languages,
    i18n,
    structure,
    videos,
    quizzes,
  });
}

// -------------------------------------------------------------- tutorials ---

const tutorials = [];
const tutorialCategories = fs
  .readdirSync(path.join(CONTENT_ROOT, 'tutorials'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const category of tutorialCategories) {
  const catDir = path.join(CONTENT_ROOT, 'tutorials', category);
  for (const slug of fs
    .readdirSync(catDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'assets')
    .map((e) => e.name)
    .sort()) {
    const dir = path.join(catDir, slug);
    const meta = readYaml(path.join(dir, 'tutorial.yml')) ?? {};
    const languages = listLangFiles(dir).sort();
    if (!languages.length) continue;

    const i18n = {};
    const content = {};
    for (const lang of CATALOG_LANGS) {
      const mdPath = path.join(dir, `${lang}.md`);
      if (!fs.existsSync(mdPath)) continue;
      const { meta: fm, body } = splitFrontmatter(fs.readFileSync(mdPath, 'utf8'));
      i18n[lang] = { name: fm.name ?? slug, description: fm.description ?? '' };
      content[lang] = body.trim();
    }

    tutorials.push({
      id: meta.id ?? null,
      slug,
      category,
      subcategory: meta.category ?? null,
      level: meta.level ?? null,
      languages,
      i18n,
      content,
    });
  }
}

// ------------------------------------------------------------- whitelist ---

const languageWhitelist = [...coverage.entries()]
  .filter(([lang, count]) => count >= MIN_COURSE_COVERAGE || EMBED_LANGS.includes(lang))
  .map(([lang, count]) => ({ lang, courses: count }))
  .sort((a, b) => b.courses - a.courses || a.lang.localeCompare(b.lang));
const excluded = [...coverage.entries()]
  .filter(([lang, count]) => count < MIN_COURSE_COVERAGE && !EMBED_LANGS.includes(lang))
  .map(([lang, count]) => `${lang} (${count})`);

// ----------------------------------------------------------------- output ---

fs.rmSync(PACKS_ROOT, { recursive: true, force: true });

// Reads and writes the quizzes of one course in one language (the first-pass
// collection only covers the embedded languages, for the bundled catalog).
function quizzesFor(courseCode, lang) {
  const quizRoot = path.join(CONTENT_ROOT, 'courses', courseCode, 'quizz');
  if (!fs.existsSync(quizRoot)) return [];
  const result = [];
  for (const qdir of fs.readdirSync(quizRoot).filter((d) => /^\d+$/.test(d)).sort()) {
    const qbase = readYaml(path.join(quizRoot, qdir, 'question.yml'));
    if (!qbase?.chapterId) continue;
    const qPath = path.join(quizRoot, qdir, `${lang}.yml`);
    if (!fs.existsSync(qPath)) continue;
    const q = readYaml(qPath);
    if (!q?.question || !q?.answer || !Array.isArray(q.wrong_answers)) continue;
    result.push({
      id: qbase.id ?? `${courseCode}-${qdir}`,
      chapterId: qbase.chapterId,
      difficulty: qbase.difficulty ?? 'easy',
      question: q.question,
      answer: q.answer,
      wrongAnswers: q.wrong_answers,
      explanation: q.explanation ?? '',
      reviewed: q.reviewed === true,
    });
  }
  return result;
}

// Every whitelisted language gets its packs, parsed per language on the fly
// (holding 28 languages of parsed markdown in memory at once would not).
// Alongside them, a per-language catalog.json carries the translated course
// and tutorial names for the Learn home when a downloadable language is
// active, the bundled TS catalog only embeds fr/en metadata.
const PACK_LANGS = languageWhitelist.map((w) => w.lang);
for (const lang of PACK_LANGS) {
  const courseDir = path.join(PACKS_ROOT, lang, 'courses');
  const quizDir = path.join(PACKS_ROOT, lang, 'quizzes');
  const tutoDir = path.join(PACKS_ROOT, lang, 'tutorials');
  fs.mkdirSync(courseDir, { recursive: true });
  fs.mkdirSync(quizDir, { recursive: true });
  fs.mkdirSync(tutoDir, { recursive: true });
  const metaCourses = {};
  const metaTutorials = {};

  for (const course of courses) {
    const mdPath = path.join(CONTENT_ROOT, 'courses', course.code, `${lang}.md`);
    if (!fs.existsSync(mdPath)) continue;
    const { meta: fm, body } = splitFrontmatter(fs.readFileSync(mdPath, 'utf8'));
    const structure = parseCourseBody(body, `courses/${course.code}/${lang}.md`);
    const chapterCount = structure.parts.reduce((n, part) => n + part.chapters.length, 0);
    metaCourses[course.code] = {
      name: fm.name ?? course.code,
      goal: fm.goal ?? '',
      objectives: fm.objectives ?? [],
      chapters: chapterCount,
    };
    fs.writeFileSync(
      path.join(courseDir, `${course.code}.json`),
      JSON.stringify({
        code: course.code,
        lang,
        commit,
        name: fm.name ?? course.code,
        goal: fm.goal ?? '',
        objectives: fm.objectives ?? [],
        assetBase: `${RAW_BASE}/${commit}/courses/${course.code}/`,
        videos: course.videos,
        intro: structure.intro,
        parts: structure.parts,
      }),
    );
    const quiz = quizzesFor(course.code, lang);
    if (quiz.length) fs.writeFileSync(path.join(quizDir, `${course.code}.json`), JSON.stringify(quiz));
  }

  for (const tuto of tutorials) {
    const mdPath = path.join(CONTENT_ROOT, 'tutorials', tuto.category, tuto.slug, `${lang}.md`);
    if (!fs.existsSync(mdPath)) continue;
    const { meta: fm, body } = splitFrontmatter(fs.readFileSync(mdPath, 'utf8'));
    metaTutorials[`${tuto.category}/${tuto.slug}`] = {
      name: fm.name ?? tuto.slug,
      description: fm.description ?? '',
    };
    const dir = path.join(tutoDir, tuto.category);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${tuto.slug}.json`),
      JSON.stringify({
        slug: tuto.slug,
        category: tuto.category,
        lang,
        commit,
        name: fm.name ?? tuto.slug,
        description: fm.description ?? '',
        assetBase: `${RAW_BASE}/${commit}/tutorials/${tuto.category}/${tuto.slug}/`,
        markdown: body.trim(),
      }),
    );
  }

  fs.writeFileSync(
    path.join(PACKS_ROOT, lang, 'catalog.json'),
    JSON.stringify({ lang, commit, courses: metaCourses, tutorials: metaTutorials }),
  );
}

// ------------------------------------------------------------ thumbnails ---
// Served locally: the originals on raw.githubusercontent are multi-thousand-
// pixel, multi-MB files. Downloaded once per corpus commit into a cache under
// scripts/data; a failed download only costs the card its image (the pixel
// placeholder takes over). Two families coexist in the corpus and get
// different treatment, recorded per course in the catalog:
//  - 'art': flat drawing on a baked near-white backdrop → backdrop keyed out
//    (distance to the corner colour, smooth ramp) so the drawing floats on
//    the app's card background, then trimmed;
//  - 'photo': photographic or gradient artwork with no flat backdrop to key
//    (detected when too few pixels match the corner colour) → left as-is,
//    shown by the UI as a framed tile, never colour-inverted.
const THUMBS_CACHE = path.join(__dirname, 'data', 'planb-thumbs', commit.slice(0, 12));
fs.mkdirSync(THUMBS_CACHE, { recursive: true });
const KINDS_PATH = path.join(THUMBS_CACHE, 'kinds.json');
const thumbKinds = fs.existsSync(KINDS_PATH) ? JSON.parse(fs.readFileSync(KINDS_PATH, 'utf8')) : {};
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  warn('sharp indisponible: vignettes stockées sans traitement.');
}

async function processThumbnail(sharpLib, input) {
  const { data, info } = await sharpLib(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [bgR, bgG, bgB] = [data[0], data[1], data[2]];
  const FULL = 40;
  const RAMP = 110;
  const totalPixels = data.length / 4;
  let backdropPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.max(
      Math.abs(data[i] - bgR),
      Math.abs(data[i + 1] - bgG),
      Math.abs(data[i + 2] - bgB),
    );
    if (d < FULL) backdropPixels++;
  }
  if (backdropPixels / totalPixels < 0.2) {
    // 'inside' keeps the whole picture: banners and logos must never be
    // cropped, the UI letterboxes them instead.
    const buffer = await sharpLib(input)
      .resize({ width: 440, height: 320, fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer();
    return { kind: 'photo', buffer };
  }
  // The keyed drawing was designed against this backdrop: light backdrop means
  // dark strokes (invert them in dark mode), dark backdrop means light
  // artwork (invert it in light mode instead). Getting this wrong shows dark
  // logos on dark cards.
  const backdropLuma = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  const kind = backdropLuma >= 140 ? 'art' : 'art-dark';
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.max(
      Math.abs(data[i] - bgR),
      Math.abs(data[i + 1] - bgG),
      Math.abs(data[i + 2] - bgB),
    );
    if (d < FULL) {
      data[i + 3] = 0;
    } else if (d < RAMP) {
      data[i + 3] = Math.min(data[i + 3], Math.round(((d - FULL) / (RAMP - FULL)) * 255));
    }
  }
  const buffer = await sharpLib(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim()
    .resize({ width: 440, height: 320, fit: 'inside' })
    .webp({ quality: 80 })
    .toBuffer();
  return { kind, buffer };
}

let thumbsFetched = 0;
async function ingestImage(kindKey, target, url, label) {
  if (fs.existsSync(target) && fs.statSync(target).size > 0 && thumbKinds[kindKey]) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let buffer = Buffer.from(await response.arrayBuffer());
    let kind = 'art';
    if (sharp) {
      const processed = await processThumbnail(sharp, buffer);
      buffer = processed.buffer;
      kind = processed.kind;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    thumbKinds[kindKey] = kind;
    thumbsFetched++;
  } catch (error) {
    warn(`Vignette introuvable pour ${label}: ${error.message}`);
  }
}

const imageJobs = [
  ...courses.map((course) => () =>
    ingestImage(
      course.code,
      path.join(THUMBS_CACHE, `${course.code}.webp`),
      `${RAW_BASE}/${commit}/courses/${course.code}/assets/thumbnail.webp`,
      course.code,
    ),
  ),
  // Tutorial covers get the exact same treatment: banner-style covers were
  // unusable cropped into tiles, and illustration-style covers deserve the
  // same keyed floating rendering as course drawings.
  ...tutorials.map((tuto) => () =>
    ingestImage(
      `${tuto.category}/${tuto.slug}`,
      path.join(THUMBS_CACHE, 'tutorials', tuto.category, `${tuto.slug}.webp`),
      `${RAW_BASE}/${commit}/tutorials/${tuto.category}/${tuto.slug}/assets/cover.webp`,
      `${tuto.category}/${tuto.slug}`,
    ),
  ),
];
const CONCURRENCY = 8;
for (let i = 0; i < imageJobs.length; i += CONCURRENCY) {
  await Promise.all(imageJobs.slice(i, i + CONCURRENCY).map((job) => job()));
}
fs.writeFileSync(KINDS_PATH, JSON.stringify(thumbKinds));

const catalogCourses = courses.map((c) => ({
  thumbKind: thumbKinds[c.code] ?? 'art',
  code: c.code,
  courseId: c.courseId,
  topic: c.topic,
  level: c.level,
  type: c.type,
  hours: c.hours,
  languages: c.languages.filter((l) => languageWhitelist.some((w) => w.lang === l)),
  i18n: c.i18n,
  chapterCount: Object.fromEntries(
    Object.entries(c.structure).map(([lang, s]) => [lang, s.parts.reduce((n, p) => n + p.chapters.length, 0)]),
  ),
  quizCount: Object.fromEntries(Object.entries(c.quizzes).map(([lang, q]) => [lang, q.length])),
}));

const catalogTutorials = tutorials.map((t) => ({
  thumbKind: thumbKinds[`${t.category}/${t.slug}`] ?? 'photo',
  id: t.id,
  slug: t.slug,
  category: t.category,
  subcategory: t.subcategory,
  level: t.level,
  languages: t.languages.filter((l) => languageWhitelist.some((w) => w.lang === l)),
  i18n: t.i18n,
}));

fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
fs.writeFileSync(
  CATALOG_PATH,
  `// Generated by scripts/build-planb-learn.mjs from PlanB-Network/bitcoin-educational-content.
// Source commit: ${commit}. Content license: CC BY-SA 4.0 (Plan B Network).
// Do not edit by hand; regenerate with PLANB_CONTENT_ROOT=<clone> node scripts/build-planb-learn.mjs
import type { LearnCatalogCourse, LearnCatalogTutorial, LearnLanguage } from '../learn-types';

export const PLANB_COMMIT = '${commit}';
export const LEARN_EMBED_LANGS = ${JSON.stringify(EMBED_LANGS)} as const;
export const LEARN_LANGUAGES: LearnLanguage[] = ${JSON.stringify(languageWhitelist)};
export const LEARN_COURSES: LearnCatalogCourse[] = ${JSON.stringify(catalogCourses)};
export const LEARN_TUTORIALS: LearnCatalogTutorial[] = ${JSON.stringify(catalogTutorials)};
`,
);

// ---------------------------------------------------------------- report ---

const du = (dir) => {
  let total = 0;
  for (const f of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) total += fs.statSync(path.join(f.parentPath ?? f.path, f.name)).size;
  }
  return (total / 1024 / 1024).toFixed(1);
};

// The full set always lands in PACKS_ROOT (that is what gets published to the
// remote base); public/ takes either everything (dev) or the embedded language
// alone (a build that reads the other languages from the remote base).
fs.rmSync(PUBLIC_PACKS_ROOT, { recursive: true, force: true });
if (PACKS_REMOTE) {
  for (const lang of EMBED_LANGS) {
    fs.cpSync(path.join(PACKS_ROOT, lang), path.join(PUBLIC_PACKS_ROOT, lang), { recursive: true });
  }
} else {
  fs.cpSync(PACKS_ROOT, PUBLIC_PACKS_ROOT, { recursive: true });
}
// Thumbnails land in both roots: locally so dev and an all-in-one build show
// the dashboard, and in the publishable root so a remote build reads its 9,5 Mo
// of cover art from the packs repository instead of carrying it. A missing
// cover degrades to the pixel placeholder, which is what makes that trade safe.
fs.cpSync(THUMBS_CACHE, path.join(PUBLIC_PACKS_ROOT, 'thumbs'), { recursive: true });
fs.cpSync(THUMBS_CACHE, path.join(PACKS_ROOT, 'thumbs'), { recursive: true });

console.log(`Corpus: ${commit.slice(0, 8)} (${CONTENT_ROOT})`);
console.log(
  PACKS_REMOTE
    ? `Packs copiés vers ${path.relative(REPO_ROOT, PUBLIC_PACKS_ROOT)} (${EMBED_LANGS.join(', ')} seulement, le reste à publier depuis ${path.relative(REPO_ROOT, PACKS_ROOT)})`
    : `Packs copiés vers ${path.relative(REPO_ROOT, PUBLIC_PACKS_ROOT)} (toutes les langues)`,
);
console.log(`Vignettes: ${fs.readdirSync(THUMBS_CACHE).filter((f) => f.endsWith('.webp')).length}/${courses.length} en cache (${thumbsFetched} téléchargées, ${Object.values(thumbKinds).filter((k) => k === 'photo').length} photos)`);
console.log(`Cours: ${courses.length} · Tutoriels: ${tutorials.length}`);
console.log(`Langues retenues (>=${MIN_COURSE_COVERAGE} cours): ${languageWhitelist.length}`);
console.log(`Langues exclues: ${excluded.join(', ') || 'aucune'}`);
for (const lang of EMBED_LANGS) {
  console.log(`Pack ${lang}: ${du(path.join(PACKS_ROOT, lang))} Mo`);
}
console.log(`Catalogue: ${(fs.statSync(CATALOG_PATH).size / 1024).toFixed(0)} Ko → ${path.relative(REPO_ROOT, CATALOG_PATH)}`);
if (warnings.length) {
  console.log(`\n${warnings.length} avertissements:`);
  for (const w of [...new Set(warnings)].slice(0, 30)) console.log(`  - ${w}`);
}
