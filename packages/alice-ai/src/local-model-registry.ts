// Pure helpers for local model entries that are not part of the default
// catalog: the files Alice used to list (kept usable and deletable once
// downloaded) and the files a user adds from a Hugging Face repository. No
// storage, no platform import, so this module is testable under node:test.

export type LocalModelSource = 'catalog' | 'legacy' | 'custom';

export type LocalModelEntry = {
  id: string;
  name: string;
  filename: string;
  sizeBytes: number;
  url: string;
  description: string;
  speed: string;
  ramNeeded: string;
  recommendation: string;
  source: LocalModelSource;
  /** Hugging Face repository (`owner/name`) for custom and legacy entries. */
  repo?: string;
  /** Git revision the download URL is pinned to, when known. */
  revision?: string;
};

export const HUGGING_FACE_ORIGIN = 'https://huggingface.co';
export const CUSTOM_MODEL_ID_PREFIX = 'custom:';

const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const GGUF_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.gguf$/;
// A folder segment of a listed path ("Q4/model.gguf"): same alphabet, no dots-only names.
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
// Sharded weights need every part on disk; a single file is the only shape
// the local runtimes load here.
const SHARD_PATTERN = /-\d{5}-of-\d{5}\.gguf$/i;

/** `owner/name` as typed by the user, trimmed of spaces and URL decoration. */
export function normalizeHuggingFaceRepo(input: string): string | null {
  let value = input.trim();
  const prefixes = [`${HUGGING_FACE_ORIGIN}/`, 'https://hf.co/', 'huggingface.co/', 'hf.co/'];
  for (const prefix of prefixes) if (value.startsWith(prefix)) value = value.slice(prefix.length);
  value = value.replace(/\/(tree|blob|resolve)\/.*$/, '').replace(/\/+$/, '');
  return REPO_PATTERN.test(value) ? value : null;
}

export type HuggingFaceGgufFile = {
  filename: string;
  sizeBytes: number;
};

export type HuggingFaceGgufListing = {
  repo: string;
  revision: string;
  license: string | null;
  gated: boolean;
  files: HuggingFaceGgufFile[];
};

/**
 * Reads the `/api/models/{repo}?blobs=true` payload. Only complete, single
 * `.gguf` weight files with a known size are kept; multimodal projector files
 * and shards are dropped because the local runtimes cannot use them alone.
 */
export function parseHuggingFaceModelListing(repo: string, payload: unknown): HuggingFaceGgufListing {
  if (!payload || typeof payload !== 'object') throw new Error('Unexpected Hugging Face response.');
  const data = payload as { sha?: unknown; gated?: unknown; cardData?: { license?: unknown }; siblings?: unknown };
  if (typeof data.sha !== 'string' || !/^[0-9a-f]{40}$/.test(data.sha)) throw new Error('The repository revision is missing.');
  const siblings = Array.isArray(data.siblings) ? data.siblings : [];
  const files: HuggingFaceGgufFile[] = [];
  for (const sibling of siblings) {
    if (!sibling || typeof sibling !== 'object') continue;
    const { rfilename, size } = sibling as { rfilename?: unknown; size?: unknown };
    if (typeof rfilename !== 'string' || !/\.gguf$/i.test(rfilename)) continue;
    if (SHARD_PATTERN.test(rfilename) || /mmproj/i.test(rfilename)) continue;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) continue;
    files.push({ filename: rfilename, sizeBytes: size });
  }
  files.sort((a, b) => a.sizeBytes - b.sizeBytes);
  const license = typeof data.cardData?.license === 'string' ? data.cardData.license : null;
  return { repo, revision: data.sha, license, gated: data.gated === true || typeof data.gated === 'string', files };
}

/** `custom:owner/name/File.gguf`, stable across sessions. */
export function customModelId(repo: string, filename: string): string {
  return `${CUSTOM_MODEL_ID_PREFIX}${repo}/${filename}`;
}

export function isCustomModelId(id: string): boolean {
  return id.startsWith(CUSTOM_MODEL_ID_PREFIX);
}

/**
 * One flat filename per repository and file, because both runtimes keep every
 * model in a single directory and reject path separators. A folder in the
 * listed path stays in the name, so two files with the same basename in two
 * folders of a repository never share a file.
 */
export function customModelFilename(repo: string, filename: string): string {
  return `${repo.replace('/', '__')}__${filename.replace(/\//g, '__')}`;
}

function humanSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * Builds the catalog-shaped entry for a user-chosen file. The URL is pinned to
 * the revision the listing came from, so a later re-download yields the same
 * bytes, and the wording tells the user Alice has not tested this model.
 */
export function buildCustomModelEntry(listing: HuggingFaceGgufListing, filename: string): LocalModelEntry {
  const repo = normalizeHuggingFaceRepo(listing.repo);
  if (!repo) throw new Error('Invalid Hugging Face repository.');
  const segments = filename.split('/');
  const base = segments[segments.length - 1] ?? '';
  if (segments.some(segment => !PATH_SEGMENT_PATTERN.test(segment) || segment.includes('..'))
    || !GGUF_FILENAME_PATTERN.test(base)) throw new Error('Invalid model filename.');
  const file = listing.files.find(candidate => candidate.filename === filename);
  if (!file) throw new Error('This file is not in the repository listing.');
  if (listing.gated) throw new Error('This repository is gated and needs a Hugging Face login; Alice downloads only public files.');
  const storedFilename = customModelFilename(repo, filename);
  if (!GGUF_FILENAME_PATTERN.test(storedFilename)) throw new Error('Invalid model filename.');
  return {
    id: customModelId(repo, filename),
    name: base.replace(/\.gguf$/i, ''),
    filename: storedFilename,
    sizeBytes: file.sizeBytes,
    // The listed path is kept whole: a file in a folder of the repository is
    // served under that folder.
    url: `${HUGGING_FACE_ORIGIN}/${repo}/resolve/${listing.revision}/${segments.map(encodeURIComponent).join('/')}`,
    description: `Custom model from ${repo}. Not tested by Alice: answers, language and safety behaviour are unverified.`,
    speed: 'Unknown',
    ramNeeded: `about ${humanSize(file.sizeBytes * 1.5)}`,
    recommendation: 'Added by you from Hugging Face. Alice has not measured this model; treat its answers with extra care and delete it if it misbehaves.',
    source: 'custom',
    repo,
    revision: listing.revision,
  };
}

/** The download URL must stay on Hugging Face, where the catalog already points. */
export function isAllowedModelDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'huggingface.co' && parsed.pathname.endsWith('.gguf');
  } catch {
    return false;
  }
}

/**
 * Parses a stored custom-model list defensively: a corrupted or hand-edited
 * value never breaks the settings screen, bad entries are simply skipped.
 */
export function parseStoredCustomModels(raw: string | null): LocalModelEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const entries: LocalModelEntry[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Partial<LocalModelEntry>;
    if (typeof entry.id !== 'string' || !isCustomModelId(entry.id) || seen.has(entry.id)) continue;
    if (typeof entry.filename !== 'string' || !GGUF_FILENAME_PATTERN.test(entry.filename)) continue;
    if (typeof entry.url !== 'string' || !isAllowedModelDownloadUrl(entry.url)) continue;
    if (typeof entry.sizeBytes !== 'number' || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0) continue;
    if (typeof entry.name !== 'string' || !entry.name) continue;
    seen.add(entry.id);
    entries.push({
      id: entry.id,
      name: entry.name,
      filename: entry.filename,
      sizeBytes: entry.sizeBytes,
      url: entry.url,
      description: typeof entry.description === 'string' ? entry.description : '',
      speed: typeof entry.speed === 'string' ? entry.speed : 'Unknown',
      ramNeeded: typeof entry.ramNeeded === 'string' ? entry.ramNeeded : '',
      recommendation: typeof entry.recommendation === 'string' ? entry.recommendation : '',
      source: 'custom',
      repo: typeof entry.repo === 'string' ? entry.repo : undefined,
      revision: typeof entry.revision === 'string' ? entry.revision : undefined,
    });
  }
  return entries;
}

export type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Lists the gguf files of a public Hugging Face repository. The only network
 * call is to huggingface.co, the host every catalog download already uses.
 */
export async function fetchHuggingFaceGgufListing(repoInput: string, fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike): Promise<HuggingFaceGgufListing> {
  const repo = normalizeHuggingFaceRepo(repoInput);
  if (!repo) throw new Error('Enter a repository as owner/name, for example unsloth/Qwen3.5-2B-GGUF.');
  const response = await fetchImpl(`${HUGGING_FACE_ORIGIN}/api/models/${repo}?blobs=true`, { headers: { Accept: 'application/json' } });
  if (response.status === 404) throw new Error('This repository does not exist or is private.');
  if (response.status === 401 || response.status === 403) throw new Error('This repository is gated and needs a Hugging Face login; Alice downloads only public files.');
  if (!response.ok) throw new Error(`Hugging Face answered ${response.status}.`);
  const listing = parseHuggingFaceModelListing(repo, await response.json());
  if (listing.files.length === 0) throw new Error('No single gguf file in this repository.');
  return listing;
}
