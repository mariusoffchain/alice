import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isExpectedModelFileSize } from './model-file-validation';
import type { ResponseLanguagePreference } from './language-policy';
import { isAllowedModelDownloadUrl, parseStoredCustomModels, type LocalModelEntry, type LocalModelSource } from './local-model-registry';

export type AIPreset = 'fast' | 'balanced' | 'deep';
/** Ids of the default catalog; a legacy or custom entry carries any other string. */
export type CatalogModelId = 'qwen3.5-2b' | 'qwen3.5-4b' | 'qwen3.5-9b';
export type LocalModelId = CatalogModelId | (string & {});
export const DEFAULT_LOCAL_MODEL_ID: CatalogModelId = 'qwen3.5-4b';

export type PresetParams = {
  temperature: number;
  maxTokens: number;
};

export type ModelEntry = LocalModelEntry;
export type { LocalModelSource };

export type ModelStatus = 'installed' | 'downloading' | 'not-installed';

// On-device budgets stay modest: a phone pays for long generations in battery
// and wall-clock time, not in provider cost.
export const PRESETS: Record<AIPreset, PresetParams> = {
  fast: { temperature: 0.3, maxTokens: 256 },
  balanced: { temperature: 0.7, maxTokens: 768 },
  deep: { temperature: 0.9, maxTokens: 1536 },
};

// Cloud budgets are circuit breakers, not the thing that ends a normal answer:
// they must be high enough that Alice finishes on her own. Raising them costs
// nothing by itself, only generated tokens are billed, so the ceiling is set
// well above what a well-behaved answer needs.
export const CLOUD_PRESETS: Record<AIPreset, PresetParams> = {
  fast: { temperature: 0.3, maxTokens: 1024 },
  balanced: { temperature: 0.7, maxTokens: 4096 },
  deep: { temperature: 0.9, maxTokens: 8192 },
};

export const ALL_PRESETS: AIPreset[] = ['fast', 'balanced', 'deep'];

// The default catalog: the models Alice proposes and has measured. Every
// other file (previous catalog entries still on disk, custom Hugging Face
// downloads) stays usable through the registry below.
export const MODEL_CATALOG: ModelEntry[] = [
  // Qwen3.5 small series (March 2026, Apache 2.0), text-only GGUF files from
  // the unsloth repositories pinned to a revision so a re-download yields the
  // same bytes. Sizes come from the Hugging Face LFS metadata of that revision.
  {
    id: 'qwen3.5-2b',
    name: 'Qwen3.5 2B',
    filename: 'Qwen3.5-2B-Q4_K_M.gguf',
    sizeBytes: 1_280_835_840,
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf',
    description: 'Lightest model for older phones. Short answers; it can hallucinate a lot, verify anything important.',
    speed: 'Fast',
    ramNeeded: '4 GB',
    source: 'catalog',
    recommendation: 'For older or low-memory phones only. Expect generic answers and invented details; Alice cannot vouch for them. Pick the 4B model whenever the phone allows it.',
  },
  {
    id: 'qwen3.5-4b',
    name: 'Qwen3.5 4B',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    sizeBytes: 2_740_937_888,
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf',
    description: 'The recommended local model: runs on every recent phone with the best balance of quality and speed.',
    speed: 'Medium',
    ramNeeded: '6 GB',
    source: 'catalog',
    recommendation: 'The default choice for phones and laptops. Follows instructions reliably in the Alice tests; a larger download than the 2B model.',
  },
  {
    id: 'qwen3.5-9b',
    name: 'Qwen3.5 9B',
    filename: 'Qwen3.5-9B-Q4_K_M.gguf',
    sizeBytes: 5_680_522_464,
    url: 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf',
    description: 'The most capable local model, for computers and high-end phones with a large download.',
    speed: 'Slow',
    ramNeeded: '12 GB',
    source: 'catalog',
    recommendation: 'For desktop computers and phones with 12 GB of memory or more. Best local quality, slowest responses, 5.7 GB to download.',
  },
];

// Previous catalog entries. They are not offered for download any more, but a
// file already on disk keeps working and can be deleted from the settings.
export const LEGACY_MODELS: ModelEntry[] = [
  {
    id: 'qwen3-0.6b',
    name: 'Qwen3 0.6B',
    filename: 'qwen3-0.6b-q4_k_m.gguf',
    sizeBytes: 484_220_192,
    url: 'https://huggingface.co/gvij/qwen3-0.6b-gguf/resolve/main/qwen3-0.6b-q4_k_m.gguf',
    description: 'Smallest local model for entry-level phones. Best for short, simple questions.',
    speed: 'Fast',
    ramNeeded: '4 GB',
    source: 'legacy',
    recommendation: 'Lite model for phones with limited memory. Answers can be generic, less accurate, or miss technical context. Not recommended for detailed Bitcoin explanations.',
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen3 1.7B',
    filename: 'Qwen_Qwen3-1.7B-Q4_K_M.gguf',
    sizeBytes: 1_282_439_584,
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf',
    description: 'A compact general-purpose model with a clear step up in quality over Lite.',
    speed: 'Medium',
    ramNeeded: '6 GB',
    source: 'legacy',
    recommendation: 'For recent mid-range phones. Good everyday choice, but responses may slow down on entry-level devices.',
  },
  {
    id: 'granite-3.3-2b',
    name: 'Granite 3.3 2B',
    filename: 'ibm-granite_granite-3.3-2b-instruct-Q4_K_M.gguf',
    sizeBytes: 1_545_303_616,
    url: 'https://huggingface.co/bartowski/ibm-granite_granite-3.3-2b-instruct-GGUF/resolve/main/ibm-granite_granite-3.3-2b-instruct-Q4_K_M.gguf',
    description: 'IBM instruction model designed for concise, reliable everyday answers.',
    speed: 'Medium',
    ramNeeded: '6 GB',
    source: 'legacy',
    recommendation: 'A balanced option for recent mid-range phones. Choose it for short explanations and practical questions.',
  },
  {
    id: 'smollm3-3b',
    name: 'SmolLM3 3B',
    filename: 'SmolLM3-Q4_K_M.gguf',
    sizeBytes: 1_915_305_312,
    url: 'https://huggingface.co/ggml-org/SmolLM3-3B-GGUF/resolve/main/SmolLM3-Q4_K_M.gguf',
    description: 'Multilingual model with strong French support and longer-context conversations.',
    speed: 'Medium',
    ramNeeded: '8 GB',
    source: 'legacy',
    recommendation: 'For upper mid-range phones. A good choice for longer Alice conversations and RAG-backed answers.',
  },
  {
    id: 'qwen3-4b',
    name: 'Qwen3 4B',
    filename: 'Qwen_Qwen3-4B-Q4_K_M.gguf',
    sizeBytes: 2_497_280_960,
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf',
    description: 'The strongest local option in Alice for detailed explanations and technical discussions.',
    speed: 'Slow',
    ramNeeded: '8 GB',
    source: 'legacy',
    recommendation: 'For high-end phones. Best local quality in this catalog, with a larger download and slower responses.',
  },
];

export type CloudModelId = 'alice-cloud';

export type CloudModelEntry = {
  id: CloudModelId;
  name: string;
  veniceId: string;
  description: string;
};

// Cloud inference runs on Venice Private Cloud. The model is not user-selectable;
// Light, Normal, and High are reasoning presets for the same catalog entry.
export const CLOUD_MODELS: CloudModelEntry[] = [
  { id: 'alice-cloud', name: 'Private Cloud', veniceId: 'e2ee-gpt-oss-120b-p', description: 'Larger off-device model' },
];

const PRESET_LOCAL_KEY = 'alice_ai_preset_local';
const PRESET_CLOUD_KEY = 'alice_ai_preset_cloud';
const ACTIVE_MODEL_KEY = 'alice_ai_local_model';
const ACTIVE_CLOUD_KEY = 'alice_ai_cloud_model';
const ALICE_INSTRUCTIONS_KEY = 'alice_ai_custom_instructions';
const RESPONSE_LANGUAGE_KEY = 'alice_ai_response_language';

export async function getPreset(backend: 'local' | 'cloud'): Promise<AIPreset> {
  const key = backend === 'local' ? PRESET_LOCAL_KEY : PRESET_CLOUD_KEY;
  const stored = await AsyncStorage.getItem(key);
  if (stored && ALL_PRESETS.includes(stored as AIPreset)) return stored as AIPreset;
  return 'balanced';
}

export async function setPreset(backend: 'local' | 'cloud', preset: AIPreset): Promise<void> {
  const key = backend === 'local' ? PRESET_LOCAL_KEY : PRESET_CLOUD_KEY;
  await AsyncStorage.setItem(key, preset);
}

export async function getActiveModelId(): Promise<LocalModelId> {
  const stored = await AsyncStorage.getItem(ACTIVE_MODEL_KEY);
  if (stored && (await listKnownLocalModels()).some(m => m.id === stored)) return stored;
  return DEFAULT_LOCAL_MODEL_ID;
}

/**
 * The first known model whose file is complete on disk: catalog first, then
 * the previous catalog, then custom files; null when nothing is installed.
 * Used when the active id points at a file that is not there, for example
 * after an update moved the default id while an older file stayed installed.
 */
export async function findInstalledLocalModelId(): Promise<LocalModelId | null> {
  for (const entry of await listKnownLocalModels()) {
    if ((await getModelStatus(entry.id)) === 'installed') return entry.id;
  }
  return null;
}

export async function getActiveCloudModelId(): Promise<CloudModelId> {
  const stored = await AsyncStorage.getItem(ACTIVE_CLOUD_KEY);
  if (stored && CLOUD_MODELS.some(m => m.id === stored)) return stored as CloudModelId;
  return 'alice-cloud';
}

export async function setActiveCloudModelId(id: CloudModelId): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_CLOUD_KEY, id);
}

export function getCloudVeniceId(id: CloudModelId): string {
  return CLOUD_MODELS.find(m => m.id === id)?.veniceId ?? CLOUD_MODELS[0].veniceId;
}

export async function setActiveModelId(id: LocalModelId): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_MODEL_KEY, id);
}

export async function getAliceInstructions(): Promise<string> {
  return (await AsyncStorage.getItem(ALICE_INSTRUCTIONS_KEY)) ?? '';
}

export async function setAliceInstructions(instructions: string): Promise<void> {
  const normalized = instructions.trim();
  if (normalized) {
    await AsyncStorage.setItem(ALICE_INSTRUCTIONS_KEY, normalized);
  } else {
    await AsyncStorage.removeItem(ALICE_INSTRUCTIONS_KEY);
  }
}

export async function getResponseLanguagePreference(): Promise<ResponseLanguagePreference> {
  const stored = await AsyncStorage.getItem(RESPONSE_LANGUAGE_KEY);
  return stored === 'fr' || stored === 'en' ? stored : 'auto';
}

export async function setResponseLanguagePreference(preference: ResponseLanguagePreference): Promise<void> {
  if (preference === 'auto') {
    await AsyncStorage.removeItem(RESPONSE_LANGUAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(RESPONSE_LANGUAGE_KEY, preference);
}

const CUSTOM_MODELS_KEY = 'alice_ai_custom_models';
// Custom entries are read from storage on demand; this cache lets the
// synchronous lookups below resolve a custom id once the list was loaded.
let customModelsCache: ModelEntry[] = [];

export async function getCustomModels(): Promise<ModelEntry[]> {
  customModelsCache = parseStoredCustomModels(await AsyncStorage.getItem(CUSTOM_MODELS_KEY));
  return customModelsCache;
}

async function saveCustomModels(entries: ModelEntry[]): Promise<void> {
  customModelsCache = entries;
  if (entries.length === 0) await AsyncStorage.removeItem(CUSTOM_MODELS_KEY);
  else await AsyncStorage.setItem(CUSTOM_MODELS_KEY, JSON.stringify(entries));
}

/** Registers a user-chosen Hugging Face file; the download is a separate step. */
export async function addCustomModel(entry: ModelEntry): Promise<void> {
  if (entry.source !== 'custom' || !isAllowedModelDownloadUrl(entry.url)) throw new Error('Only Hugging Face gguf files can be added.');
  if (MODEL_CATALOG.some(m => m.id === entry.id || m.filename === entry.filename) || LEGACY_MODELS.some(m => m.filename === entry.filename)) {
    throw new Error('This model is already in the catalog.');
  }
  const current = (await getCustomModels()).filter(m => m.id !== entry.id && m.filename !== entry.filename);
  await saveCustomModels([...current, entry]);
}

export async function removeCustomModel(id: LocalModelId): Promise<void> {
  await saveCustomModels((await getCustomModels()).filter(m => m.id !== id));
}

/**
 * Every entry the app knows: the catalog, the previous catalog entries and the
 * custom files. Callers that only want installable choices filter on source.
 */
export async function listKnownLocalModels(): Promise<ModelEntry[]> {
  return [...MODEL_CATALOG, ...LEGACY_MODELS, ...(await getCustomModels())];
}

export function findModelEntry(id: LocalModelId): ModelEntry | undefined {
  return MODEL_CATALOG.find(m => m.id === id) ?? LEGACY_MODELS.find(m => m.id === id) ?? customModelsCache.find(m => m.id === id);
}

export function getModelEntry(id: LocalModelId): ModelEntry {
  const entry = findModelEntry(id);
  if (!entry) throw new Error(`Unknown local model: ${id}`);
  return entry;
}

export function getModelName(id: LocalModelId): string {
  return findModelEntry(id)?.name ?? id;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

async function downloadedFileIsComplete(entry: ModelEntry): Promise<boolean> {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}models/${entry.filename}`);
    return info.exists && isExpectedModelFileSize(info.size, entry.sizeBytes);
  } catch {
    return false;
  }
}

export async function getModelStatus(id: LocalModelId): Promise<ModelStatus> {
  if (Platform.OS === 'web') return 'not-installed';
  const entry = getModelEntry(id);
  if (await downloadedFileIsComplete(entry)) return 'installed';
  return 'not-installed';
}

export async function getModelPath(id: LocalModelId): Promise<string> {
  const entry = getModelEntry(id);
  const FileSystem = await import('expo-file-system/legacy');
  const dir = `${FileSystem.documentDirectory}models/`;
  const dest = `${dir}${entry.filename}`;

  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists) {
    if (isExpectedModelFileSize(info.size, entry.sizeBytes)) return dest;
    throw new Error(`${entry.name} download is incomplete. Delete it and download it again.`);
  }

  throw new Error(`${entry.name} is not installed.`);
}

export async function installModel(
  id: LocalModelId,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (Platform.OS === 'web') throw new Error('Install not available on web.');
  const entry = getModelEntry(id);
  const FileSystem = await import('expo-file-system/legacy');
  const dir = `${FileSystem.documentDirectory}models/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const dest = `${dir}${entry.filename}`;
  const partial = `${dest}.download`;

  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists && !isExpectedModelFileSize(existing.size, entry.sizeBytes)) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }

  const callback = (progress: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
    if (onProgress && progress.totalBytesExpectedToWrite > 0) {
      onProgress(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
    }
  };

  await FileSystem.deleteAsync(partial, { idempotent: true });
  try {
    const download = FileSystem.createDownloadResumable(entry.url, partial, {}, callback);
    const result = await download.downloadAsync();
    if (!result || result.status !== 200) {
      throw new Error(`Download failed (status ${result?.status ?? 'unknown'}).`);
    }

    const info = await FileSystem.getInfoAsync(partial);
    if (!info.exists || !isExpectedModelFileSize(info.size, entry.sizeBytes)) {
      const received = info.exists && typeof info.size === 'number' ? info.size : 0;
      throw new Error(`Download incomplete (${received} of ${entry.sizeBytes} bytes).`);
    }

    await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.moveAsync({ from: partial, to: dest });
  } catch (error) {
    await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {});
    throw error;
  }
}

async function reassignActiveAfterDelete(deletedId: LocalModelId): Promise<void> {
  const activeId = await getActiveModelId();
  if (activeId !== deletedId) return;
  for (const entry of await listKnownLocalModels()) {
    if (entry.id === deletedId) continue;
    if ((await getModelStatus(entry.id)) === 'installed') {
      await setActiveModelId(entry.id);
      return;
    }
  }
  // No model left installed; keep the active id pointing at the deleted one so
  // the chat surfaces the "no model" state instead of silently switching.
}

export async function deleteModel(id: LocalModelId): Promise<void> {
  const entry = getModelEntry(id);
  const FileSystem = await import('expo-file-system/legacy');
  await FileSystem.deleteAsync(`${FileSystem.documentDirectory}models/${entry.filename}`, { idempotent: true });
  // A deleted custom file leaves the list too; the user can add it back.
  if (entry.source === 'custom') await removeCustomModel(id);
  await reassignActiveAfterDelete(id);
}

export async function deleteAllModels(): Promise<void> {
  if (Platform.OS === 'web') return;
  const FileSystem = await import('expo-file-system/legacy');
  for (const entry of await listKnownLocalModels()) {
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}models/${entry.filename}`, { idempotent: true });
  }
  await saveCustomModels([]);
}

export async function hasAnyInstalledModel(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  for (const entry of await listKnownLocalModels()) {
    if ((await getModelStatus(entry.id)) === 'installed') return true;
  }
  return false;
}

// AI enabled/disabled toggle

const AI_ENABLED_KEY = 'alice_ai_enabled';
const BACKEND_ENABLED_KEY_PREFIX = 'alice_ai_backend_enabled_';
const LEGACY_LOCAL_AI_ENABLED_KEY = 'alice_ai_local_enabled';
const LEGACY_CLOUD_AI_ENABLED_KEY = 'alice_ai_cloud_enabled';

export type AIBackendEnabledState = {
  local: boolean;
  cloud: boolean;
  custom: boolean;
};

export async function isAIEnabled(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(AI_ENABLED_KEY);
  return stored !== 'false';
}

export async function setAIEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AI_ENABLED_KEY, String(enabled));
}

export async function isAIBackendEnabled(backend: keyof AIBackendEnabledState): Promise<boolean> {
  const stored = await AsyncStorage.getItem(`${BACKEND_ENABLED_KEY_PREFIX}${backend}`);
  if (stored !== null) return stored !== 'false';

  // Keep existing local and cloud preferences when moving to the shared
  // per-backend setting. Custom has always defaulted to enabled.
  const legacyKey = backend === 'local'
    ? LEGACY_LOCAL_AI_ENABLED_KEY
    : backend === 'cloud'
      ? LEGACY_CLOUD_AI_ENABLED_KEY
      : null;
  if (!legacyKey) return true;
  return (await AsyncStorage.getItem(legacyKey)) !== 'false';
}

export async function setAIBackendEnabled(
  backend: keyof AIBackendEnabledState,
  enabled: boolean,
): Promise<void> {
  await AsyncStorage.setItem(`${BACKEND_ENABLED_KEY_PREFIX}${backend}`, String(enabled));
}

export async function getAIBackendEnabledState(): Promise<AIBackendEnabledState> {
  const [local, cloud, custom] = await Promise.all([
    isAIBackendEnabled('local'),
    isAIBackendEnabled('cloud'),
    isAIBackendEnabled('custom'),
  ]);
  return { local, cloud, custom };
}

export const isLocalAIEnabled = () => isAIBackendEnabled('local');
export const setLocalAIEnabled = (enabled: boolean) => setAIBackendEnabled('local', enabled);
export const isCloudAIEnabled = () => isAIBackendEnabled('cloud');
export const setCloudAIEnabled = (enabled: boolean) => setAIBackendEnabled('cloud', enabled);

// Custom server (compatible local or remote endpoint)

export type CustomServerConfig = {
  url: string;
  model: string;
  apiKey?: string;
};

const CUSTOM_SERVER_KEY = 'alice_ai_custom_server';

export async function getCustomServer(): Promise<CustomServerConfig | null> {
  const stored = await AsyncStorage.getItem(CUSTOM_SERVER_KEY);
  if (!stored) return null;
  try { return JSON.parse(stored); } catch { return null; }
}

export async function setCustomServer(config: CustomServerConfig | null): Promise<void> {
  if (config) {
    await AsyncStorage.setItem(CUSTOM_SERVER_KEY, JSON.stringify(config));
  } else {
    await AsyncStorage.removeItem(CUSTOM_SERVER_KEY);
  }
}
