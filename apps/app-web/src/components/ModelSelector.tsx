'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOpenSettings } from '@/lib/settings-url';
import {
  type AIBackendType,
  type AIPreset,
  type CloudModelId,
  type LocalModelId,
  type ModelStatus,
  ALL_PRESETS,
  CLOUD_MODELS,
  MODEL_CATALOG,
  formatSize,
  getActiveCloudModelId,
  getActiveModelId,
  getCustomServer,
  getDesktopModelStatus,
  getPreset,
  isTauriDesktop,
  setActiveCloudModelId,
  setActiveModelId,
  setPreset,
} from '@alice-wallet/alice-ai';

const REASONING_LABELS: Record<AIPreset, string> = {
  fast: 'Light',
  balanced: 'Medium',
  deep: 'High',
};

const defaultLocalModelStatus = Object.fromEntries(
  MODEL_CATALOG.map((model) => [model.id, 'not-installed' as ModelStatus]),
) as Record<LocalModelId, ModelStatus>;

type ModelSelectorProps = {
  backendType: AIBackendType;
  setBackendType: (type: AIBackendType) => void;
  setAiEnabled: (enabled: boolean) => void;
  compactLabel?: boolean;
  placement?: 'above' | 'mobile-header' | 'below';
};

export function ModelSelector({
  backendType,
  setBackendType,
  setAiEnabled,
  compactLabel = false,
  placement = 'above',
}: ModelSelectorProps) {
  const openSettings = useOpenSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hasCustomServer, setHasCustomServer] = useState(false);
  const [activeLocalModelId, setActiveLocalModelState] = useState<LocalModelId>('qwen3-0.6b');
  const [activeCloudModelId, setActiveCloudModelState] = useState<CloudModelId>('alice-cloud');
  const [localPreset, setLocalPresetState] = useState<AIPreset>('balanced');
  const [cloudPreset, setCloudPresetState] = useState<AIPreset>('balanced');
  const [localModelStatus, setLocalModelStatus] = useState<Record<LocalModelId, ModelStatus>>(defaultLocalModelStatus);

  const refreshLocalModels = async () => {
    if (!isTauriDesktop()) return;
    const statuses = await Promise.all(
      MODEL_CATALOG.map(async (model) => ({
        id: model.id,
        status: await getDesktopModelStatus(model.id),
      })),
    );
    setLocalModelStatus(prev => {
      const next = { ...prev };
      for (const { id, status } of statuses) next[id] = status;
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      const [activeLocal, activeCloud, localReasoning, cloudReasoning, customServer] = await Promise.all([
        getActiveModelId(),
        getActiveCloudModelId(),
        getPreset('local'),
        getPreset('cloud'),
        getCustomServer(),
      ]);
      setActiveLocalModelState(activeLocal);
      setActiveCloudModelState(activeCloud);
      setLocalPresetState(localReasoning);
      setCloudPresetState(cloudReasoning);
      setHasCustomServer(!!customServer?.url);
      await refreshLocalModels();
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      getActiveModelId(),
      getActiveCloudModelId(),
      getPreset('local'),
      getPreset('cloud'),
      getCustomServer(),
    ]).then(([activeLocal, activeCloud, localReasoning, cloudReasoning, customServer]) => {
      setActiveLocalModelState(activeLocal);
      setActiveCloudModelState(activeCloud);
      setLocalPresetState(localReasoning);
      setCloudPresetState(cloudReasoning);
      setHasCustomServer(!!customServer?.url);
      return refreshLocalModels();
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const installedLocalModels = useMemo(
    () => MODEL_CATALOG.filter((model) => localModelStatus[model.id] === 'installed'),
    [localModelStatus],
  );

  const activePreset = backendType === 'cloud' ? cloudPreset : localPreset;
  const activeLocalModel = MODEL_CATALOG.find(model => model.id === activeLocalModelId);
  const activeModelName =
    backendType === 'cloud'
      ? 'Private'
      : backendType === 'custom'
        ? 'Custom server'
        : activeLocalModel?.name ?? 'Local model';

  const handleReasoning = async (preset: AIPreset) => {
    if (backendType === 'cloud') {
      setCloudPresetState(preset);
      await setPreset('cloud', preset);
    } else {
      setLocalPresetState(preset);
      await setPreset('local', preset);
    }
  };

  const handleLocalModel = async (id: LocalModelId) => {
    setActiveLocalModelState(id);
    await setActiveModelId(id);
    // Always re-select: setBackendType re-initializes the engine even when the
    // type is unchanged, which is what actually reloads llama-server with the
    // newly chosen model.
    setBackendType('local');
    setOpen(false);
  };

  const handleCloudModel = async (id: CloudModelId) => {
    setActiveCloudModelState(id);
    await setActiveCloudModelId(id);
    setAiEnabled(true);
    if (backendType !== 'cloud') setBackendType('cloud');
    setOpen(false);
  };

  const handleCustomServer = () => {
    setBackendType('custom');
    setOpen(false);
  };

  const handleAddLocalModel = () => {
    setOpen(false);
    openSettings('ai');
  };

  return (
    <div ref={rootRef} className="relative min-w-0 max-w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="font-numbers flex h-9 max-w-full min-w-0 items-center gap-1.5 cursor-pointer px-2"
        style={{
          fontSize: compactLabel ? 18 : 15,
          lineHeight: compactLabel ? '22px' : '18px',
          color: 'var(--alice-muted)',
          backgroundColor: 'transparent',
          border: 'none',
          outline: 'none',
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {activeModelName}
        </span>
        {!compactLabel && (
          <span className="shrink-0" style={{ opacity: 0.7 }}>{REASONING_LABELS[activePreset]}</span>
        )}
        {compactLabel && (
          <span
            aria-hidden="true"
            className="shrink-0"
            style={{
              width: 7,
              height: 7,
              borderRight: '1px solid currentColor',
              borderBottom: '1px solid currentColor',
              opacity: 0.7,
              transform: 'rotate(45deg) translate(-2px, 2px)',
            }}
          />
        )}
      </button>

      {open && (
        <div
          className={
            placement === 'mobile-header' ? 'fixed'
              : placement === 'below' ? 'absolute left-0'
                : 'absolute right-0'
          }
          style={{
            ...(placement === 'mobile-header'
              ? {
                  top: 'calc(env(safe-area-inset-top) + 52px)',
                  left: 20,
                  right: 20,
                }
              : placement === 'below'
                ? {
                    top: 'calc(100% + 8px)',
                    width: 296,
                    maxWidth: 'calc(100vw - 40px)',
                  }
                : {
                    bottom: 'calc(100% + 8px)',
                    width: 296,
                    maxWidth: 'calc(100vw - 40px)',
                  }),
            padding: 8,
            backgroundColor: 'var(--alice-bg-soft)',
            border: '2px solid var(--alice-border)',
            borderRadius: 6,
            boxShadow: '0 12px 28px rgba(0,0,0,0.28)',
            zIndex: 30,
          }}
        >
          <MenuSection label="REASONING" />
          <div style={{ display: 'flex', gap: 6, padding: '2px 6px 4px' }}>
            {ALL_PRESETS.map((preset) => (
              <CompactChip
                key={preset}
                label={REASONING_LABELS[preset]}
                active={preset === activePreset}
                onClick={() => handleReasoning(preset)}
              />
            ))}
          </div>

          <MenuDivider />
          <MenuSection label="LOCAL MODELS" />
          {installedLocalModels.length > 0 ? installedLocalModels.map((model) => (
            <MenuItem
              key={model.id}
              label={model.name}
              detail={formatSize(model.sizeBytes)}
              active={backendType === 'local' && model.id === activeLocalModelId}
              onClick={() => handleLocalModel(model.id)}
            />
          )) : (
            <div className="font-numbers" style={{ fontSize: 14, opacity: 0.55, padding: '8px 6px' }}>
              No downloaded local model
            </div>
          )}
          <MenuItem
            label="Add a new local model"
            detail="Open Settings"
            active={false}
            onClick={handleAddLocalModel}
          />

          {/* A server the user controls is still off-device when remote, so it
              never sits under LOCAL MODELS. */}
          {hasCustomServer && (
            <>
              <MenuDivider />
              <MenuSection label="CUSTOM SERVER" />
              <MenuItem
                label="Custom server"
                detail="OpenAI-compatible"
                active={backendType === 'custom'}
                onClick={handleCustomServer}
              />
            </>
          )}

          <MenuDivider />
          <MenuSection label="PRIVATE" />
          {CLOUD_MODELS.map((model) => (
            <MenuItem
              key={model.id}
              label="Private"
              detail={model.description}
              active={backendType === 'cloud' && model.id === activeCloudModelId}
              onClick={() => handleCloudModel(model.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuSection({ label }: { label: string }) {
  return (
    <div className="font-pixel tracking-widest" style={{ fontSize: 10, opacity: 0.48, padding: '6px 6px 3px' }}>
      {label}
    </div>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, backgroundColor: 'var(--alice-border)', opacity: 0.7, margin: '6px 6px' }} />;
}

function CompactChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const backgroundColor = active
    ? hovered
      ? 'color-mix(in srgb, var(--alice-primary) 92%, white)'
      : 'var(--alice-primary)'
    : hovered
      ? 'color-mix(in srgb, var(--alice-primary) 12%, transparent)'
      : 'transparent';

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex-1 cursor-pointer"
      style={{
        minHeight: 28,
        padding: '6px 8px',
        border: 'none',
        borderRadius: 4,
        outline: 'none',
        backgroundColor,
        color: active ? 'var(--alice-on-primary)' : 'var(--alice-text)',
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
    >
      <span className="font-numbers" style={{ fontSize: 15 }}>{label}</span>
    </button>
  );
}

function MenuItem({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail?: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const backgroundColor = active
    ? hovered
      ? 'color-mix(in srgb, var(--alice-primary) 92%, white)'
      : 'var(--alice-primary)'
    : hovered
      ? 'color-mix(in srgb, var(--alice-primary) 12%, transparent)'
      : 'transparent';

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="w-full text-left flex items-center justify-between gap-3 cursor-pointer"
      style={{
        minHeight: 30,
        padding: '6px 8px',
        border: 'none',
        borderRadius: 4,
        outline: 'none',
        backgroundColor,
        color: active ? 'var(--alice-on-primary)' : 'var(--alice-text)',
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
    >
      <span
        className="font-numbers"
        style={{
          fontSize: 15,
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {detail && (
        <span
          className="font-pixel shrink-0"
          style={{
            fontSize: 10,
            opacity: active ? 0.92 : 0.55,
            letterSpacing: 0.8,
            maxWidth: 110,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {active ? 'ACTIVE' : detail}
        </span>
      )}
      {active && !detail && <span className="font-pixel shrink-0" style={{ fontSize: 10 }}>✓</span>}
    </button>
  );
}
