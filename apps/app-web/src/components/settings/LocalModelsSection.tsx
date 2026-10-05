'use client';

import { useEffect, useState, useRef } from 'react';
import { SvgIcon } from '@/components/SvgIcon';
import { CHEVRON_RIGHT_ICON, CHEVRON_DOWN_ICON, DOWNLOAD_ICON, CHECK_ICON, DELETE_ICON } from '@/lib/atelier-icons';
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
import { SectionHint, SectionLabel, sectionStyle, useDialogFocus } from './ui';
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
  const modelDialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(selectedLocalModel !== null, modelDialogRef);

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
            <div className="flex flex-col" >
              {installedLocalModels.map((model, index) => {
                const state = localModelStates[model.id];
                const installed = state.status === 'installed';
                const downloading = state.status === 'downloading';
                const active = installed && activeModelId === model.id;
                const progress = state.downloadProgress === null ? null : Math.round(state.downloadProgress * 100);
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => !downloading && setSelectedLocalModel(model.id)}
                    disabled={downloading}
                    className="alice-control alice-control--row font-numbers w-full text-left"
                    style={{ display: 'block', borderTop: index === 0 ? 'none' : '1px solid var(--alice-border)' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div style={{ minWidth: 0 }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-primary-dark)' }}>
                            {model.name}
                          </span>
                          <span className="font-numbers" style={{ fontSize: 13, opacity: 1 }}>
                            {formatSize(model.sizeBytes)}
                          </span>
                        </div>
                        <p className="font-numbers m-0 mt-1" style={{ fontSize: 14, opacity: 1, lineHeight: '18px' }}>
                          {model.description}
                        </p>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {active && <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-primary)' }}>ACTIVE</span>}
                          {installed && <span className="font-numbers" style={{ fontSize: 13, opacity: 1 }}>INSTALLED</span>}
                          {!installed && !downloading && <span className="font-numbers" style={{ fontSize: 13, opacity: 1 }}>NOT INSTALLED</span>}
                          <span className="font-numbers" style={{ fontSize: 13, opacity: 1 }}>{model.ramNeeded}</span>
                        </div>
                        <p className="font-numbers m-0 mt-2" style={{ fontSize: 13, opacity: 1 }}>
                          {downloading ? 'Downloading...' : 'Open details'}
                        </p>
                        {downloading && progress !== null && (
                          <div className="flex items-center gap-2 mt-2">
                            <div role="progressbar" aria-label={`Downloading ${model.name}`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, flex: 1, border: '1px solid var(--alice-border)' }}>
                              <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--alice-primary)' }} />
                            </div>
                            <span className="font-numbers" style={{ fontSize: 13, opacity: 1 }}>{progress}%</span>
                          </div>
                        )}
                      </div>
                      <span className="font-numbers  shrink-0" style={{ fontSize: 13, opacity: 1 }}>
                        {!downloading && <SvgIcon svg={CHEVRON_RIGHT_ICON} size={16} color="currentColor" />}
                      </span>
                    </div>
                  </button>
                );
              })}
              {installedLocalModels.length === 0 && (
                <div style={{ padding: 12 }}>
                  <span className="font-numbers" style={{ fontSize: 13, opacity: 1 }}>
                    NO LOCAL MODEL INSTALLED
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={() => setLocalDownloadOpen(!localDownloadOpen)}
              className="alice-control alice-control--quiet font-numbers w-full text-left mt-3"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              disabled={downloadableLocalModels.length === 0}
            >
              <span>{downloadableLocalModels.length === 0 ? 'All local models installed' : 'Choose a model to download'}</span>
              <span style={{ transform: localDownloadOpen ? 'rotate(180deg)' : undefined }}><SvgIcon svg={CHEVRON_DOWN_ICON} size={16} color="currentColor" /></span>
            </button>
            {localDownloadOpen && downloadableLocalModels.length > 0 && (
              <div
                className="mt-1"
                style={{
                  borderLeft: '2px solid var(--alice-border)',
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
                    className="alice-control alice-control--row font-numbers w-full text-left"
                    style={{ display: 'block', borderTop: index === 0 ? 'none' : '1px solid var(--alice-border)' }}
                  >
                    <span className="font-numbers" style={{ fontSize: 13 }}>
                      {model.name}
                    </span>
                    <span style={{ opacity: 1, marginLeft: 8, fontSize: 14 }}>
                      {formatSize(model.sizeBytes)}
                    </span>
                    <div style={{ opacity: 1, marginTop: 4, lineHeight: '18px' }}>
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
                className="alice-control alice-control--danger font-numbers"
              >
                Remove all local models
              </button>
            </div>
          </>
        ) : (
          <p className="font-numbers m-0 mt-2" style={{ fontSize: 15, opacity: 1 }}>
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
            ref={modelDialogRef}
            role="dialog"
            onKeyDown={event => {
              if (event.key === 'Escape') { event.stopPropagation(); setSelectedLocalModel(null); }
            }}
            aria-modal="true"
            aria-label={selectedLocalModelEntry.name}
            onClick={(e) => e.stopPropagation()}
            style={{
              ...sectionStyle,
              marginBottom: 0,
              padding: 24,
              border: '1px solid var(--alice-border)',
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
                <p className="font-numbers  m-0 mt-2" style={{ fontSize: 13, opacity: 1 }}>
                  {formatSize(selectedLocalModelEntry.sizeBytes)}
                </p>
              </div>
              <button
                onClick={() => setSelectedLocalModel(null)}
                className="alice-control alice-control--quiet font-numbers"
              >
                BACK
              </button>
            </div>

            <p className="font-numbers m-0 mt-4" style={{ fontSize: 15, lineHeight: '20px', opacity: 1 }}>
              {selectedLocalModelEntry.description}
            </p>

            <div className="grid grid-cols-2 gap-2 mt-4">
              <div style={{ borderBottom: '1px solid var(--alice-border)', padding: '10px 0' }}>
                <p className="font-numbers  m-0" style={{ fontSize: 13, opacity: 1 }}>SPEED</p>
                <p className="font-numbers m-0 mt-2" style={{ fontSize: 14 }}>{selectedLocalModelEntry.speed}</p>
              </div>
              <div style={{ borderBottom: '1px solid var(--alice-border)', padding: '10px 0' }}>
                <p className="font-numbers  m-0" style={{ fontSize: 13, opacity: 1 }}>RAM NEEDED</p>
                <p className="font-numbers m-0 mt-2" style={{ fontSize: 14 }}>{selectedLocalModelEntry.ramNeeded}</p>
              </div>
            </div>

            <div className="mt-4" style={{ borderTop: '1px solid var(--alice-border)', paddingTop: 12 }}>
              <p className="font-numbers m-0" style={{ fontSize: 14, lineHeight: '18px', opacity: 1 }}>
                {selectedLocalModelEntry.recommendation}
              </p>
            </div>

            <div className="flex gap-2 mt-4 flex-wrap">
              {selectedLocalModelState.status !== 'installed' && (
                <button
                  onClick={() => handleInstallLocalModel(selectedLocalModelEntry.id)}
                  className="alice-control alice-control--primary font-numbers"
                >
                  <SvgIcon svg={DOWNLOAD_ICON} size={20} color="currentColor" />
                  {`DOWNLOAD ${formatSize(selectedLocalModelEntry.sizeBytes)}`}
                </button>
              )}
              {selectedLocalModelState.status === 'installed' && selectedLocalModelEntry.id !== activeModelId && (
                <button
                  onClick={() => handleActivateLocalModel(selectedLocalModelEntry.id)}
                  className="alice-control alice-control--primary font-numbers"
                >
                  <SvgIcon svg={CHECK_ICON} size={20} color="currentColor" /> Use this model
                </button>
              )}
              {selectedLocalModelState.status === 'installed' && (
                <button
                  onClick={() => handleDeleteLocalModel(selectedLocalModelEntry.id)}
                  className="alice-control alice-control--danger font-numbers"
                >
                  <SvgIcon svg={DELETE_ICON} size={16} color="currentColor" /> Remove
                </button>
              )}
              <button
                onClick={() => setSelectedLocalModel(null)}
                className="alice-control alice-control--quiet font-numbers"
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
