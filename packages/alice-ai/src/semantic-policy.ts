// Platform-neutral policy for the semantic search model download: when it may
// start on its own, and what the settings surface can show. The browser and
// native runtimes both consume this; the decisions themselves stay pure so
// they can be tested without a DOM or a device.

/** Where the semantic layer stands, as shown in Settings. */
export type SemanticSearchStatus =
  // The platform build has no semantic engine at all (Expo web/PWA).
  | 'unsupported'
  // The user removed the model or switched the feature off.
  | 'off'
  // Nothing loaded yet; the first question will trigger the download.
  | 'idle'
  // Auto-download was withheld because the connection asked for data saving.
  | 'blocked-metered'
  | 'loading'
  | 'ready'
  | 'failed';

export type SemanticSearchState = {
  status: SemanticSearchStatus;
  /** 0..1 while loading, when the platform can measure it. */
  progress: number | null;
};

/** 'auto': download on first use. 'off': never download, keyword search only. */
export type SemanticSearchPreference = 'auto' | 'off';

export const SEMANTIC_SEARCH_PREFERENCE_KEY = 'alice.semantic-search.v1';

/** Window event dispatched whenever the runtime state changes. */
export const SEMANTIC_SEARCH_STATE_EVENT = 'alice-semantic-search-state';

/**
 * What the one-time download costs, for display before it happens. Model
 * weights plus tokenizer as served by the hub; the exact byte count varies
 * with the runtime's choice of files, so this is deliberately a round figure.
 */
export const SEMANTIC_MODEL_DOWNLOAD_BYTES = 150_000_000;

/** Exact GGUF size downloaded by the native runtime, without the web WASM files. */
export const NATIVE_SEMANTIC_MODEL_DOWNLOAD_BYTES = 131_953_504;

export function parseSemanticSearchPreference(raw: unknown): SemanticSearchPreference {
  return raw === 'off' ? 'off' : 'auto';
}

/**
 * May the download start without the user asking for it right now?
 * `saveData` is the browser's data-saving signal (metered or user-restricted
 * connection); an explicit user action in Settings bypasses this via `force`
 * at the call site, never through this predicate.
 */
export function canAutoStartSemanticDownload(
  preference: SemanticSearchPreference,
  saveData: boolean,
): boolean {
  return preference === 'auto' && !saveData;
}
