const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The corpus source vault is maintainer-local and never ships with the repo.
// The generated packages/alice-ai/src/generated/obsidian-rag.ts is committed,
// so contributors build Alice without this vault; only corpus regeneration
// needs it. Point ALICE_VAULT_ROOT at your own vault to regenerate.
const VAULT_ROOT = process.env.ALICE_VAULT_ROOT;
if (!VAULT_ROOT) {
  console.error('Set ALICE_VAULT_ROOT to the Obsidian vault that holds the Alice corpus.');
  process.exit(1);
}
const PROJECT_ROOT = path.join(VAULT_ROOT, '10 Projects/Alice Bitcoin');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'Resources/alice-corpus-import-manifest.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'packages', 'alice-ai', 'src', 'generated', 'obsidian-rag.ts');
const TRANSLATION_CACHE_PATH = path.join(__dirname, 'data', 'alice-rag-translations.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sourceHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function inferLocale(text) {
  const normalized = text.toLowerCase();
  const french = (normalized.match(/\b(?:le|la|les|des|une|est|dans|pour|avec|qui|que|cette|permet)\b/g) ?? []).length
    + (normalized.match(/[àâçéèêëîïôùûüÿœ]/g) ?? []).length;
  const english = (normalized.match(/\b(?:the|is|are|in|for|with|that|this|allows|from|and)\b/g) ?? []).length;
  return french > english ? 'fr' : 'en';
}

function loadTranslationCache() {
  if (!fs.existsSync(TRANSLATION_CACHE_PATH)) return { version: 1, translations: {} };
  const cache = readJson(TRANSLATION_CACHE_PATH);
  if (cache.version !== 1 || typeof cache.translations !== 'object') {
    throw new Error('Unsupported Alice RAG translation cache format.');
  }
  return cache;
}

function stripFrontmatter(markdown) {
  return markdown.replace(/^---[\s\S]*?---\n*/, '');
}

function extractTitle(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function extractSection(markdown, headings) {
  for (const heading of headings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, 'm');
    const match = markdown.match(regex);
    if (match) return match[1].trim();
  }
  return '';
}

function extractBulletLines(section) {
  return section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^[-*]\s+/.test(line))
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function toSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function inferLevel(entry) {
  const lowerPath = entry.path.toLowerCase();
  const advancedThemes = new Set(['arkade', 'advanced_wallet', 'governance', 'dev_fundamentals']);
  const intermediateThemes = new Set(['nodes', 'addresses', 'lightning', 'mining', 'privacy', 'economics', 'geopolitics']);

  if (lowerPath.includes('/taproot assets/') || lowerPath.includes('/development/')) return 'advanced';
  if (advancedThemes.has(entry.theme)) return 'advanced';
  if (intermediateThemes.has(entry.theme) || entry.status === 'secondaire') return 'intermediate';
  return 'beginner';
}

function keywordVariants(text) {
  const clean = text.trim();
  if (!clean) return [];
  const ascii = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lower = clean.toLowerCase();
  const lowerAscii = ascii.toLowerCase();
  return Array.from(new Set([clean, lower, ascii, lowerAscii].filter(Boolean)));
}

const KEYWORD_STOPWORDS = new Set([
  'bitcoin',
  'btc',
  'les',
  'des',
  'une',
  'un',
  'elle',
  'elles',
  'il',
  'ils',
  'comme',
  'pourquoi',
  'comment',
  'quiconque',
]);

function isUsefulKeyword(keyword) {
  const normalized = keyword
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (!normalized) return false;
  if (KEYWORD_STOPWORDS.has(normalized)) return false;
  if (normalized.length < 4) return false;
  return true;
}

// English is the primary retrieval language (most external Bitcoin sources and
// most users are English-first), French is the vault's native authoring language
// and stays fully supported. This glossary lets a French-titled note surface an
// English keyword variant automatically instead of only being reachable in French.
const FR_TO_EN_GLOSSARY = {
  geopolitique: 'geopolitics',
  financiere: 'financial',
  financier: 'financial',
  energetique: 'energy',
  energie: 'energy',
  electricite: 'electricity',
  implementations: 'implementations',
  implementation: 'implementation',
  numerique: 'digital',
  numeriques: 'digital',
  regulation: 'regulation',
  reglementation: 'regulation',
  europeenne: 'european',
  europeen: 'european',
  et: 'and',
  monnaie: 'currency',
  banque: 'bank',
  centrale: 'central',
  portefeuille: 'wallet',
  adresse: 'address',
  adresses: 'addresses',
  reseau: 'network',
  noeud: 'node',
  cle: 'key',
  cles: 'keys',
  privee: 'private',
  publique: 'public',
  sauvegarde: 'backup',
  recuperation: 'recovery',
  recuperer: 'recover',
  restaurer: 'restore',
  paiement: 'payment',
  paiements: 'payments',
  frais: 'fees',
  confidentialite: 'privacy',
  vie: 'life',
  chiffrement: 'encryption',
  securite: 'security',
  minage: 'mining',
  mineur: 'miner',
  mineurs: 'miners',
  difficulte: 'difficulty',
  bloc: 'block',
  canal: 'channel',
  liquidite: 'liquidity',
  echange: 'exchange',
  garde: 'custody',
  autogarde: 'self-custody',
  heritage: 'inheritance',
  succession: 'inheritance',
  arnaque: 'scam',
  arnaques: 'scams',
  hameconnage: 'phishing',
  vol: 'theft',
  perdu: 'lost',
  telecharger: 'download',
  loi: 'law',
  gouvernement: 'government',
  etat: 'state',
  censure: 'censorship',
  epargne: 'savings',
  investissement: 'investment',
  achat: 'purchase',
  vente: 'sale',
  prix: 'price',
  volatilite: 'volatility',
  rarete: 'scarcity',
  offre: 'supply',
  unite: 'unit',
  compte: 'account',
  surveillance: 'surveillance',
  crypto: 'crypto',
  bitcoin: 'bitcoin',
};

function translateFrenchToken(token) {
  const normalized = token
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return FR_TO_EN_GLOSSARY[normalized] ?? null;
}

function translateFrenchPhrase(phrase) {
  const parts = phrase.split(/(\s+|[-—])/);
  let translatedAny = false;
  const translated = parts.map(part => {
    if (!/[A-Za-zÀ-ÿ]/.test(part)) return part;
    const translation = translateFrenchToken(part);
    if (!translation) return part;
    translatedAny = true;
    return part[0] === part[0].toUpperCase() ? translation[0].toUpperCase() + translation.slice(1) : translation;
  });
  return translatedAny ? translated.join('') : null;
}

function inferKeywords(entry, title, markdown) {
  const source = [];
  source.push(title);
  source.push(entry.theme.replace(/_/g, ' '));
  source.push(path.basename(entry.path, path.extname(entry.path)));

  const relatedSection = extractSection(markdown, ['Related Notes', 'Related PlanB Notes', 'Related Notes from This Extraction']);
  const relatedMatches = Array.from(relatedSection.matchAll(/\[\[([^\]]+)\]\]/g)).map(match => match[1]);
  source.push(...relatedMatches.slice(0, 8));

  const summary = extractSection(markdown, ['Summary', 'Résumé']);
  const capitalizedPhrases = Array.from(summary.matchAll(/\b([A-Z][A-Za-z0-9.+-]{2,}(?:\s+[A-Z][A-Za-z0-9.+-]{2,}){0,2})\b/g)).map(match => match[1]);
  source.push(...capitalizedPhrases.slice(0, 6));

  const englishVariants = source
    .map(translateFrenchPhrase)
    .filter((value) => value !== null);
  source.push(...englishVariants);

  return Array.from(new Set(source.flatMap(keywordVariants).filter(isUsefulKeyword))).slice(0, 24);
}

function buildContent(markdown) {
  const summary = extractSection(markdown, ['Summary', 'Résumé']);
  const keyPoints = extractSection(markdown, ['Key Points', 'Points clés', 'Points cles']);
  const whyItMatters = extractSection(markdown, ['Why It Matters', 'Pourquoi c\'est important']);
  const courseInsight = extractSection(markdown, ['Course Insight']);
  const practicalTakeaways = extractSection(markdown, ['Practical Takeaways']);

  const segments = [];
  if (summary) segments.push(toSentence(summary));

  const pointLines = [
    ...extractBulletLines(keyPoints),
    ...extractBulletLines(practicalTakeaways),
  ].slice(0, 6);
  if (pointLines.length > 0) {
    segments.push(`Key points: ${pointLines.map(toSentence).join(' ')}`);
  }

  if (whyItMatters) segments.push(`Why it matters: ${toSentence(whyItMatters)}`);
  if (courseInsight) segments.push(`Additional context: ${toSentence(courseInsight)}`);

  return segments.join(' ').replace(/\s+/g, ' ').trim();
}

function escapeTsString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function main() {
  const manifest = readJson(MANIFEST_PATH);
  const translationCache = loadTranslationCache();
  const generatedChunks = [];
  const missingFiles = [];

  for (const entry of manifest.entries) {
    const absolutePath = path.isAbsolute(entry.path) ? entry.path : path.join(PROJECT_ROOT, entry.path);
    if (!fs.existsSync(absolutePath)) {
      missingFiles.push(entry.path);
      continue;
    }

    const rawMarkdown = fs.readFileSync(absolutePath, 'utf8');
    const markdown = stripFrontmatter(rawMarkdown);
    const fallbackTitle = path.basename(entry.path, path.extname(entry.path));
    const title = extractTitle(markdown, fallbackTitle);
    const content = buildContent(markdown);

    if (!content) continue;

    const id = `obsidian-${entry.id}`;
    const locale = inferLocale(`${title}\n${content}`);
    const hash = sourceHash(`${title}\n${content}`);
    generatedChunks.push({
      id,
      conceptId: id,
      title,
      keywords: inferKeywords(entry, title, markdown),
      level: inferLevel(entry),
      content,
      phase: entry.phase,
      priority: entry.priority,
      status: entry.status,
      surface: entry.surface,
      theme: entry.theme,
      retrievalWeight: entry.retrieval_weight,
      sourcePath: entry.vault_relative_path,
      locale,
      sourceLocale: locale,
      translationStatus: 'source',
      sourceHash: hash,
    });

    const cached = translationCache.translations[id];
    if (cached && cached.sourceHash === hash && cached.locale !== locale && cached.title && cached.content) {
      generatedChunks.push({
        id: `${id}__${cached.locale}`,
        conceptId: id,
        title: cached.title,
        keywords: Array.isArray(cached.keywords) ? cached.keywords : inferKeywords(entry, cached.title, cached.content),
        level: inferLevel(entry),
        content: cached.content,
        phase: entry.phase,
        priority: entry.priority,
        status: entry.status,
        surface: entry.surface,
        theme: entry.theme,
        retrievalWeight: entry.retrieval_weight,
        sourcePath: entry.vault_relative_path,
        locale: cached.locale,
        sourceLocale: locale,
        translationStatus: cached.status === 'reviewed' ? 'reviewed' : 'machine',
        sourceHash: hash,
      });
    }
  }

  const lines = [];
  lines.push('// Auto-generated from Obsidian corpus manifest. Do not edit by hand.');
  lines.push('');
  lines.push("import type { KnowledgeChunk } from '../knowledge-packs';");
  lines.push('');
  lines.push('type GeneratedObsidianKnowledgeChunk = KnowledgeChunk & {');
  lines.push('  phase: number;');
  lines.push('  priority: string;');
  lines.push('  status: string;');
  lines.push('  surface: string;');
  lines.push('};');
  lines.push('');
  lines.push('export const GENERATED_OBSIDIAN_KNOWLEDGE_BASE: readonly GeneratedObsidianKnowledgeChunk[] = [');

  for (const chunk of generatedChunks) {
    lines.push('  {');
    lines.push(`    id: '${escapeTsString(chunk.id)}',`);
    lines.push(`    conceptId: '${escapeTsString(chunk.conceptId)}',`);
    lines.push(`    title: '${escapeTsString(chunk.title)}',`);
    lines.push(`    keywords: [${chunk.keywords.map(keyword => `'${escapeTsString(keyword)}'`).join(', ')}],`);
    lines.push(`    level: '${chunk.level}',`);
    lines.push(`    content: '${escapeTsString(chunk.content)}',`);
    lines.push(`    phase: ${chunk.phase},`);
    lines.push(`    priority: '${chunk.priority}',`);
    lines.push(`    status: '${chunk.status}',`);
    lines.push(`    surface: '${chunk.surface}',`);
    lines.push(`    theme: '${chunk.theme}',`);
    lines.push(`    retrievalWeight: ${chunk.retrievalWeight},`);
    lines.push(`    sourcePath: '${escapeTsString(chunk.sourcePath)}',`);
    lines.push(`    locale: '${chunk.locale}',`);
    lines.push(`    sourceLocale: '${chunk.sourceLocale}',`);
    lines.push(`    translationStatus: '${chunk.translationStatus}',`);
    lines.push(`    sourceHash: '${chunk.sourceHash}',`);
    lines.push('  },');
  }

  lines.push('] as const;');
  lines.push('');

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${lines.join('\n')}\n`, 'utf8');

  console.log(`Generated ${generatedChunks.length} Obsidian chunks.`);
  const localeCounts = generatedChunks.reduce((counts, chunk) => {
    counts[chunk.locale] = (counts[chunk.locale] ?? 0) + 1;
    return counts;
  }, {});
  const incomplete = generatedChunks.filter(chunk => (
    !chunk.conceptId
    || !['fr', 'en'].includes(chunk.locale)
    || !['fr', 'en'].includes(chunk.sourceLocale)
    || !chunk.translationStatus
    || !chunk.sourceHash
  ));
  if (incomplete.length > 0) {
    throw new Error(`${incomplete.length} generated chunks are missing language metadata.`);
  }
  console.log(`Corpus languages: fr=${localeCounts.fr ?? 0}, en=${localeCounts.en ?? 0}.`);
  console.log(`Validated language metadata and source hashes for ${generatedChunks.length} chunks.`);
  if (missingFiles.length > 0) {
    console.warn(`Skipped ${missingFiles.length} missing files.`);
  }
}

main();
