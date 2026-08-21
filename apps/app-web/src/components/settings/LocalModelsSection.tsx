'use client';

import { useEffect, useState } from 'react';
import {
  type LocalModelId,
  type ModelStatus,
  MODEL_CATALOG,
  formatSize,
  getActiveModelId,
  setActiveModelId,
  isTauriDesktop,
  getDesktopModelStatus,
  deleteDesktopModel,
  deleteAllDesktopModels,
  useChat,
} from '@alice-wallet/alice-ai';
import { btnBase, DANGER, SectionHint, SectionLabel, sectionStyle } from './ui';
import { MODEL_DOWNLOAD_EVENT, getModelDownloads, startModelDownload } from '@/lib/model-downloads';

type LocalModelState = {
  status: ModelStatus;
  downloadProgress: number | null;
};

const defaultLocalModelStates = Object.fromEntries(
  MODEL_CATALOG.map(model => [
    model.id,
    { status: 'not-installed' as ModelStatus, downloadProgress: null },
  ]),
) as Record<LocalModelId, LocalModelState>;

/**
 * Downloads, activates and deletes the on-device models. Desktop only: the web
 * build has nowhere to put a multi-gigabyte weight file.
 */
export function LocalModelsSection() {
  const chat = useChat();
  const isDesktop = isTauriDesktop();
  const [activeModelId, setActiveModelState] = useState<LocalModelId>('qwen3-0.6b');
  const [localModelStates, setLocalModelStates] = useState<Record<LocalModelId, LocalModelState>>(defaultLocalModelStates);
  const [selectedLocalModel, setSelectedLocalModel] = useState<LocalModelId | null>(null);
  const [localDownloadOpen, setLocalDownloadOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setActiveModelState(await getActiveModelId());
        if (!isDesktop) return;
        const statuses = await Promise.all(
          MODEL_CATALOG.map(async model => ({
            id: model.id,
            status: await getDesktopModelStatus(model.id),
          })),
        );
        setLocalModelStates(prev => {
          const next = { ...prev };
          for (const { id, status } of statuses) {
            if (next[id]?.status !== 'downloading') next[id] = { ...next[id], status };
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    })();
  }, [isDesktop]);

  const refreshDesktopModelStates = async () => {
    const statuses = await Promise.all(
      MODEL_CATALOG.map(async model => ({
        id: model.id,
        status: await getDesktopModelStatus(model.id),
      })),
    );
    setLocalModelStates(prev => {
      const next = { ...prev };
      for (const { id, status } of statuses) next[id] = { status, downloadProgress: null };
      return next;
    });
  };

  const handleActivateLocalModel = async (id: LocalModelId) => {
    await setActiveModelId(id);
    setActiveModelState(id);
    chat.setBackendType('local');
    setSelectedLocalModel(null);
  };

  // Downloads run in the module-level manager, so they survive leaving this
  // page; here we only start them and mirror their state.
  const handleInstallLocalModel = (id: LocalModelId) => {
    setSelectedLocalModel(null);
    setLocalDownloadOpen(false);
    startModelDownload(id);
  };

  useEffect(() => {
    const sync = () => {
      setLocalModelStates(prev => {
        const next = { ...prev };
        for (const [id, download] of getModelDownloads()) {
          if (download.status === 'downloading') {
            next[id] = { status: 'downloading', downloadProgress: download.progress };
          } else if (download.status === 'installed') {
            next[id] = { status: 'installed', downloadProgress: null };
          } else if (next[id]?.status === 'downloading') {
            next[id] = { status: 'not-installed', downloadProgress: null };
          }
        }
        return next;
      });
      for (const [, download] of getModelDownloads()) {
        if (download.status === 'installed') {
          getActiveModelId().then(setActiveModelState).catch(() => {});
        }
      }
    };
    sync();
    window.addEventListener(MODEL_DOWNLOAD_EVENT, sync);
    return () => window.removeEventListener(MODEL_DOWNLOAD_EVENT, sync);
  }, []);

  const handleDeleteLocalModel = async (id: LocalModelId) => {
    setSelectedLocalModel(null);
    await deleteDesktopModel(id);
    if (activeModelId === id) {
      const fallback = MODEL_CATALOG.find(model => model.id !== id && localModelStates[model.id].status === 'installed');
      if (fallback) {
        await setActiveModelId(fallback.id);
        setActiveModelState(fallback.id);
      }
    }
    await refreshDesktopModelStates();
  };

  const installedLocalModels = MODEL_CATALOG.filter(model => {
    const status = localModelStates[model.id].status;
    return status === 'installed' || status === 'downloading';
  });
  const downloadableLocalModels = MODEL_CATALOG.filter(model => localModelStates[model.id].status === 'not-installed');
  const selectedLocalModelEntry = selectedLocalModel
    ? MODEL_CATALOG.find((model) => model.id === selectedLocalModel)
    : null;
  const selectedLocalModelState = selectedLocalModel
    ? localModelStates[selectedLocalModel]
    : null;

  return (
    <>
      <div style={sectionStyle}>
        <SectionLabel>LOCAL MODELS</SectionLabel>
        {isDesktop ? (
          <>
            <SectionHint>
              Same local model catalog as Alice mobile. Models download on
              demand; none is preinstalled.
            </SectionHint>
            <div className="flex flex-col" style={{ border: '2px solid var(--alice-border)', borderRadius: 2, overflow: 'hidden', backgroundColor: 'var(--alice-bg)' }}>
              {installedLocalModels.map((model, index) => {
                const state = localModelStates[model.id];
                const installed = state.status === 'installed';
                const downloading = state.status === 'downloading';
                const active = activeModelId === model.id;
                const progress = Math.round((state.downloadProgress ?? 0) * 100);
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => !downloading && setSelectedLocalModel(model.id)}
                    disabled={downloading}
                    className="w-full text-left"
                    style={{
                      padding: '12px',
                      borderTop: index === 0 ? 'none' : '1px solid var(--alice-border)',
                      borderRight: 'none',
                      borderBottom: 'none',
                      borderLeft: 'none',
                      backgroundColor: 'var(--alice-bg)',
                      color: 'inherit',
                      cursor: downloading ? 'default' : 'pointer',
                      opacity: downloading ? 0.75 : 1,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div style={{ minWidth: 0 }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-primary-dark)' }}>
                            {model.name}
                          </span>
                          <span className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.45 }}>
                            {formatSize(model.sizeBytes)}
                          </span>
                        </div>
                        <p className="font-numbers m-0 mt-1" style={{ fontSize: 14, opacity: 0.65, lineHeight: '18px' }}>
                          {model.description}
                        </p>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {active && <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-primary)' }}>ACTIVE</span>}
                          {installed && <span className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.55 }}>INSTALLED</span>}
                          {!installed && !downloading && <span className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.45 }}>NOT INSTALLED</span>}
                          <span className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.45 }}>{model.ramNeeded}</span>
                        </div>
                        <p className="font-numbers m-0 mt-2" style={{ fontSize: 13, opacity: 0.45 }}>
                          {downloading ? 'Downloading...' : 'Open details'}
                        </p>
                        {downloading && (
                          <div className="flex items-center gap-2 mt-2">
                            <div style={{ height: 6, flex: 1, border: '1px solid var(--alice-border)' }}>
                              <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--alice-primary)' }} />
                            </div>
                            <span className="font-pixel" style={{ fontSize: 10, opacity: 0.7 }}>{progress}%</span>
                          </div>
                        )}
                      </div>
                      <span className="font-pixel tracking-widest shrink-0" style={{ fontSize: 10, opacity: 0.5 }}>
                        {downloading ? '' : '>'}
                      </span>
                    </div>
                  </button>
                );
              })}
              {installedLocalModels.length === 0 && (
                <div style={{ padding: 12 }}>
                  <span className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.55 }}>
                    NO LOCAL MODEL INSTALLED
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => setLocalDownloadOpen(!localDownloadOpen)}
              className="font-pixel tracking-widest w-full text-left mt-3"
              style={{
                ...btnBase,
                padding: '8px 12px',
                backgroundColor: 'var(--alice-bg)',
                color: 'var(--alice-primary-dark)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                opacity: downloadableLocalModels.length === 0 ? 0.55 : 1,
              }}
              disabled={downloadableLocalModels.length === 0}
            >
              <span>{downloadableLocalModels.length === 0 ? 'All local models installed' : 'Choose a model to download'}</span>
              <span style={{ fontSize: 10 }}>{localDownloadOpen ? '▲' : '▼'}</span>
            </button>
            {localDownloadOpen && downloadableLocalModels.length > 0 && (
              <div
                className="mt-1"
                style={{
                  border: '2px solid var(--alice-primary)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                {downloadableLocalModels.map((model, index) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      setLocalDownloadOpen(false);
                      setSelectedLocalModel(model.id);
                    }}
                    className="font-numbers w-full text-left"
                    style={{
                      fontSize: 15,
                      padding: '10px 12px',
                      backgroundColor: 'transparent',
                      color: 'var(--alice-primary)',
                      border: 'none',
                      borderTop: index === 0 ? 'none' : '1px solid var(--alice-border)',
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    <span className="font-pixel tracking-widest" style={{ fontSize: 10 }}>
                      {model.name}
                    </span>
                    <span style={{ opacity: 0.5, marginLeft: 8, fontSize: 14 }}>
                      {formatSize(model.sizeBytes)}
                    </span>
                    <div style={{ opacity: 0.6, marginTop: 4, lineHeight: '18px' }}>
                      {model.description}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-3 justify-end">
              <button
                onClick={async () => {
                  await deleteAllDesktopModels();
                  await refreshDesktopModelStates();
                }}
                className="font-pixel tracking-widest"
                style={{
                  ...btnBase,
                  backgroundColor: 'transparent',
                  color: DANGER,
                  borderColor: DANGER,
                }}
              >
                DELETE ALL
              </button>
            </div>
          </>
        ) : (
          <p className="font-numbers m-0 mt-2" style={{ fontSize: 15, opacity: 0.7 }}>
            Local models run inside the Alice desktop and mobile apps, where
            they can use your hardware.{' '}
            <a
              href="https://alicebtc.com/"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--alice-primary)', textDecoration: 'underline' }}
            >
              Get the app
            </a>
            .
          </p>
        )}
      </div>

      {selectedLocalModelEntry && selectedLocalModelState && (
        <div
          className="fixed inset-0 flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 80 }}
          onClick={() => setSelectedLocalModel(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...sectionStyle,
              marginBottom: 0,
              maxWidth: 420,
              width: '100%',
              backgroundColor: 'var(--alice-bg)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-pixel tracking-widest m-0" style={{ fontSize: 10, color: 'var(--alice-primary-dark)' }}>
                  {selectedLocalModelEntry.name}
                </h3>
                <p className="font-pixel tracking-widest m-0 mt-2" style={{ fontSize: 10, opacity: 0.55 }}>
                  {formatSize(selectedLocalModelEntry.sizeBytes)}
                </p>
              </div>
              <button
                onClick={() => setSelectedLocalModel(null)}
                className="font-pixel tracking-widest"
                style={{ ...btnBase, padding: '4px 8px', backgroundColor: 'transparent' }}
              >
                BACK
              </button>
            </div>

            <p className="font-numbers m-0 mt-4" style={{ fontSize: 15, lineHeight: '20px', opacity: 0.82 }}>
              {selectedLocalModelEntry.description}
            </p>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <div style={{ border: '1px solid var(--alice-border)', padding: 10 }}>
                <p className="font-pixel tracking-widest m-0" style={{ fontSize: 10, opacity: 0.55 }}>SPEED</p>
                <p className="font-numbers m-0 mt-2" style={{ fontSize: 14 }}>{selectedLocalModelEntry.speed}</p>
              </div>
              <div style={{ border: '1px solid var(--alice-border)', padding: 10 }}>
                <p className="font-pixel tracking-widest m-0" style={{ fontSize: 10, opacity: 0.55 }}>RAM NEEDED</p>
                <p className="font-numbers m-0 mt-2" style={{ fontSize: 14 }}>{selectedLocalModelEntry.ramNeeded}</p>
              </div>
            </div>

            <div className="mt-4" style={{ backgroundColor: 'var(--alice-card-bg)', border: '1px solid var(--alice-border)', padding: 12 }}>
              <p className="font-numbers m-0" style={{ fontSize: 14, lineHeight: '18px', opacity: 0.75 }}>
                {selectedLocalModelEntry.recommendation}
              </p>
            </div>

            <div className="flex gap-2 mt-4 flex-wrap">
              {selectedLocalModelState.status !== 'installed' && (
                <button
                  onClick={() => handleInstallLocalModel(selectedLocalModelEntry.id)}
                  className="font-pixel tracking-widest"
                  style={{ ...btnBase, backgroundColor: 'var(--alice-primary)', color: 'var(--alice-on-primary)' }}
                >
                  {`DOWNLOAD ${formatSize(selectedLocalModelEntry.sizeBytes)}`}
                </button>
              )}
              {selectedLocalModelState.status === 'installed' && selectedLocalModelEntry.id !== activeModelId && (
                <button
                  onClick={() => handleActivateLocalModel(selectedLocalModelEntry.id)}
                  className="font-pixel tracking-widest"
                  style={{ ...btnBase, backgroundColor: 'var(--alice-primary)', color: 'var(--alice-on-primary)' }}
                >
                  ACTIVATE
                </button>
              )}
              {selectedLocalModelState.status === 'installed' && (
                <button
                  onClick={() => handleDeleteLocalModel(selectedLocalModelEntry.id)}
                  className="font-pixel tracking-widest"
                  style={{ ...btnBase, color: DANGER, borderColor: DANGER, backgroundColor: 'transparent' }}
                >
                  DELETE
                </button>
              )}
              <button
                onClick={() => setSelectedLocalModel(null)}
                className="font-pixel tracking-widest"
                style={{ ...btnBase, backgroundColor: 'transparent' }}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
