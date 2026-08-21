import {
  installDesktopModel,
  setActiveModelId,
  type LocalModelId,
} from '@alice-wallet/alice-ai';

// Module-level download manager: a model download belongs to the app, not to
// the settings page that happened to start it. Leaving settings (or closing
// the dialog) no longer loses the progress display, and completion is
// announced by a toast wherever the user is. State is in-memory: an app
// restart drops it, and the partial file is cleaned up by the installer.

export type ModelDownload =
  | { status: 'downloading'; progress: number }
  | { status: 'installed'; progress: 1 }
  | { status: 'error'; progress: 0; error: string };

export const MODEL_DOWNLOAD_EVENT = 'alice-model-download';

const downloads = new Map<LocalModelId, ModelDownload>();

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MODEL_DOWNLOAD_EVENT));
}

export function getModelDownloads(): ReadonlyMap<LocalModelId, ModelDownload> {
  return downloads;
}

export function startModelDownload(id: LocalModelId): void {
  if (downloads.get(id)?.status === 'downloading') return;
  downloads.set(id, { status: 'downloading', progress: 0 });
  emit();
  void installDesktopModel(id, (progress) => {
    downloads.set(id, { status: 'downloading', progress });
    emit();
  })
    .then(async () => {
      downloads.set(id, { status: 'installed', progress: 1 });
      // The freshly installed model becomes the active local model, matching
      // the previous install flow; switching the chat backend stays a user
      // gesture.
      await setActiveModelId(id).catch(() => {});
      emit();
    })
    .catch((error: unknown) => {
      downloads.set(id, {
        status: 'error',
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      emit();
    });
}

/** Acknowledge a finished (installed or error) download, e.g. from the toast. */
export function clearModelDownload(id: LocalModelId): void {
  const state = downloads.get(id);
  if (state && state.status !== 'downloading') {
    downloads.delete(id);
    emit();
  }
}
