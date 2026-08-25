'use client';

import { useEffect, useState } from 'react';
import { MODEL_CATALOG, type LocalModelId } from '@alice-wallet/alice-ai';
import {
  MODEL_DOWNLOAD_EVENT,
  clearModelDownload,
  getModelDownloads,
} from '@/lib/model-downloads';

// Lateral notification for background model downloads: mounted once at the
// app root, so "model ready" (or "download failed") reaches the user wherever
// they navigated to in the meantime. Finished states auto-dismiss.

const AUTO_DISMISS_MS = 8000;

interface Toast {
  id: LocalModelId;
  kind: 'installed' | 'error';
  detail?: string;
}

export function ModelDownloadToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const seen = new Set<string>();
    const sync = () => {
      for (const [id, state] of getModelDownloads()) {
        if (state.status === 'downloading') continue;
        const key = `${id}:${state.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const toast: Toast = {
          id,
          kind: state.status,
          detail: state.status === 'error' ? state.error : undefined,
        };
        setToasts((current) => [...current.filter((t) => t.id !== id), toast]);
        window.setTimeout(() => {
          setToasts((current) => current.filter((t) => t !== toast));
          clearModelDownload(id);
          seen.delete(key);
        }, AUTO_DISMISS_MS);
      }
    };
    sync();
    window.addEventListener(MODEL_DOWNLOAD_EVENT, sync);
    return () => window.removeEventListener(MODEL_DOWNLOAD_EVENT, sync);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed z-50 flex flex-col gap-2" style={{ right: 16, bottom: 76 }}>
      {toasts.map((toast) => {
        const name = MODEL_CATALOG.find((m) => m.id === toast.id)?.name ?? toast.id;
        return (
          <button
            key={`${toast.id}:${toast.kind}`}
            type="button"
            onClick={() => {
              setToasts((current) => current.filter((t) => t !== toast));
              clearModelDownload(toast.id);
            }}
            className="text-left cursor-pointer"
            style={{
              maxWidth: 320,
              padding: '10px 14px',
              border: `2px solid ${toast.kind === 'installed' ? 'var(--alice-primary)' : 'var(--alice-danger, #c74f4f)'}`,
              borderRadius: 2,
              background: 'var(--alice-bg-soft)',
              color: 'var(--alice-text)',
            }}
          >
            <div
              className="font-pixel"
              style={{
                fontSize: 7,
                color: toast.kind === 'installed' ? 'var(--alice-primary)' : 'var(--alice-danger, #c74f4f)',
              }}
            >
              {toast.kind === 'installed' ? 'MODEL READY' : 'DOWNLOAD FAILED'}
            </div>
            <div className="font-numbers" style={{ fontSize: 13, marginTop: 6 }}>
              {toast.kind === 'installed'
                ? `${name} is installed and set as your local model.`
                : `${name}: ${toast.detail ?? 'download failed'}. Try again from Settings.`}
            </div>
          </button>
        );
      })}
    </div>
  );
}
