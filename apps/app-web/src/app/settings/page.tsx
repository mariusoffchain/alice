'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { BalanceFormat } from '@alice-wallet/alice-ui/balance-format';
import { setAmountFormat, useAmountState } from '@/components/AmountDisplay';
import {
  type CustomServerConfig,
  type ChatCleanupMode,
  type ChatStorageSummary,
  type LocalModelId,
  type ModelStatus,
  MODEL_CATALOG,
  CLOUD_MODELS,
  CLOUD_DEEP_MODEL,
  formatSize,
  setPreset,
  getAliceInstructions,
  setAliceInstructions,
  getResponseLanguagePreference,
  setResponseLanguagePreference,
  type ResponseLanguagePreference,
  getActiveModelId,
  setActiveModelId,
  setActiveCloudModelId,
  getCustomServer,
  setCustomServer,
  isTauriDesktop,
  getDesktopModelStatus,
  installDesktopModel,
  deleteDesktopModel,
  deleteAllDesktopModels,
  useChat,
  MAX_CHAT_SESSIONS,
  trackProductEvent,
} from '@alice-wallet/alice-ai';
import {
  PALETTES,
  ALL_PALETTE_IDS,
  type PaletteId,
} from '@alice-wallet/alice-content';
import { configurableNetworks, getNodeOverride, setNodeOverride } from '@/lib/explorer/node-config';
import { getNetwork } from '@/lib/explorer/networks';

/* ------------------------------------------------------------------ */
/*  Pixel Wheel constants                                              */
/* ------------------------------------------------------------------ */

const GRID = 37;
const GAP = 1;
const INNER_RATIO = 0.4;
const PALETTE_COUNT = ALL_PALETTE_IDS.length; // 8

type WheelRegion =
  | { type: 'empty' }
  | { type: 'toggle'; half: 'light' | 'dark' }
  | { type: 'palette'; id: PaletteId };

function regionAt(
  px: number,
  py: number,
  outerR: number,
  innerR: number,
): WheelRegion {
  const dist = Math.hypot(px, py);
  if (dist > outerR) return { type: 'empty' };
  if (dist <= innerR) {
    const half = px < 0 ? 'light' : 'dark';
    return { type: 'toggle', half };
  }
  const angle = (Math.atan2(py, px) * (180 / Math.PI) + 90 + 360) % 360;
  const idx = Math.floor(angle / (360 / PALETTE_COUNT)) % PALETTE_COUNT;
  return { type: 'palette', id: ALL_PALETTE_IDS[idx] };
}

function wheelColor(
  region: WheelRegion,
  _activePalette: PaletteId,
  mode: 'light' | 'dark',
): string | null {
  if (region.type === 'empty') return null;
  if (region.type === 'toggle') {
    return region.half === 'dark' ? '#1a1a1a' : '#ffffff';
  }
  const palette = PALETTES[region.id];
  // For mono, use dark/light-aware primary
  let color: string;
  if (region.id === 'mono') {
    color = mode === 'dark' ? '#e0e0e0' : '#1a1a1a';
  } else {
    color = palette.primary;
  }
  return color;
}

/* ------------------------------------------------------------------ */
/*  PixelWheel SVG component                                           */
/* ------------------------------------------------------------------ */

function PixelWheel({
  activePalette,
  mode,
  onSelectPalette,
  onToggleMode,
}: {
  activePalette: PaletteId;
  mode: 'light' | 'dark';
  onSelectPalette: (id: PaletteId) => void;
  onToggleMode: () => void;
}) {
  const cellSize = 8;
  const totalSize = GRID * (cellSize + GAP) - GAP;
  const half = GRID / 2;
  const outerR = half;
  const innerR = outerR * INNER_RATIO;

  const rects = useMemo(() => {
    const result: { x: number; y: number; color: string; region: WheelRegion }[] = [];
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const px = col - half + 0.5;
        const py = row - half + 0.5;
        const region = regionAt(px, py, outerR, innerR);
        const color = wheelColor(region, activePalette, mode);
        if (color) {
          result.push({
            x: col * (cellSize + GAP),
            y: row * (cellSize + GAP),
            color,
            region,
          });
        }
      }
    }
    return result;
  }, [activePalette, mode, half, outerR, innerR]);

  const handleClick = useCallback(
    (region: WheelRegion) => {
      if (region.type === 'toggle') {
        onToggleMode();
      } else if (region.type === 'palette') {
        onSelectPalette(region.id);
      }
    },
    [onSelectPalette, onToggleMode],
  );

  return (
    <svg
      viewBox={`0 0 ${totalSize} ${totalSize}`}
      width={totalSize}
      height={totalSize}
      style={{ maxWidth: '100%', cursor: 'pointer' }}
    >
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={cellSize}
          height={cellSize}
          fill={r.color}
          onClick={() => handleClick(r.region)}
          style={{ cursor: r.region.type !== 'empty' ? 'pointer' : 'default' }}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared UI atoms                                                    */
/* ------------------------------------------------------------------ */

// The same unit preference as the wallet's balance (alice_balance_format):
// changing it here changes every amount in Explorer and the wallet alike.
const UNIT_OPTIONS: { value: BalanceFormat; label: string }[] = [
  { value: 'symbol', label: '₿' },
  { value: 'sats', label: 'sats' },
  { value: 'btc', label: 'BTC' },
  { value: 'usd', label: '$' },
];

function BalanceUnitSection() {
  const amount = useAmountState();
  return (
    <div style={sectionStyle}>
      <SectionLabel>BALANCE UNIT</SectionLabel>
      <p className="font-numbers m-0 mt-1 mb-3" style={{ fontSize: 14, opacity: 0.5 }}>
        How amounts are shown across Explorer, shared with the wallet. Clicking any amount in the app cycles it too.
      </p>
      <div className="flex gap-2">
        {UNIT_OPTIONS.map((opt) => {
          const active = amount.format === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAmountFormat(opt.value)}
              className="font-numbers cursor-pointer"
              style={{
                fontSize: 14,
                padding: '8px 16px',
                border: `2px solid ${active ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
                borderRadius: 2,
                backgroundColor: active ? 'var(--alice-primary)' : 'transparent',
                color: active ? 'var(--alice-on-primary)' : 'var(--alice-text)',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--alice-card-bg)',
  border: '2px solid var(--alice-border)',
  borderRadius: 2,
  padding: 16,
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 8,
  opacity: 0.7,
  letterSpacing: '0.15em',
  marginBottom: 8,
};

const btnBase: React.CSSProperties = {
  fontSize: 10,
  border: '2px solid var(--alice-border)',
  borderRadius: 2,
  cursor: 'pointer',
  outline: 'none',
  letterSpacing: '0.12em',
  padding: '8px 14px',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-pixel tracking-widest m-0" style={labelStyle}>
      {children}
    </h3>
  );
}

function PixelSwitch({
  label,
  enabled,
  onChange,
  disabled = false,
}: {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className="flex items-center cursor-pointer"
      style={{ minHeight: 36, padding: 0, border: 0, background: 'transparent', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <span
        className="flex items-center"
        style={{
          width: 52,
          height: 28,
          padding: 3,
          border: `2px solid ${enabled ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
          borderRadius: 0,
          backgroundColor: enabled ? 'var(--alice-primary)' : 'transparent',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            marginLeft: enabled ? 24 : 0,
            borderRadius: 0,
            backgroundColor: enabled ? 'var(--alice-on-primary)' : 'var(--alice-muted)',
            transition: 'margin-left 140ms ease',
          }}
        />
      </span>
    </button>
  );
}

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

function getInitialAppearance(): { mode: 'light' | 'dark'; palette: PaletteId } {
  if (typeof window === 'undefined') return { mode: 'dark', palette: 'blue' };
  const storedMode = localStorage.getItem('alice_theme_mode') as 'light' | 'dark' | null;
  const storedPalette = localStorage.getItem('alice_palette') as PaletteId | null;
  return {
    mode: storedMode === 'light' || storedMode === 'dark' ? storedMode : 'dark',
    palette: storedPalette && ALL_PALETTE_IDS.includes(storedPalette) ? storedPalette : 'blue',
  };
}

function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/*  Main settings page                                                 */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const router = useRouter();
  const chat = useChat();
  const desktopLocalFirst = isTauriDesktop();

  /* ----- Instructions ----- */
  const [instructions, setInstructions] = useState('');
  const [savedInstructions, setSavedInstructions] = useState('');
  const [responseLanguage, setResponseLanguageState] = useState<ResponseLanguagePreference>('auto');

  /* ----- Custom server ----- */
  const [customUrl, setCustomUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customConnected, setCustomConnected] = useState(false);

  /* ----- Local model catalog ----- */
  const [activeModelId, setActiveModelState] = useState<LocalModelId>('qwen3-0.6b');
  const [localModelStates, setLocalModelStates] = useState<Record<LocalModelId, LocalModelState>>(defaultLocalModelStates);
  const [selectedLocalModel, setSelectedLocalModel] = useState<LocalModelId | null>(null);
  const [localDownloadOpen, setLocalDownloadOpen] = useState(false);

  /* ----- Appearance ----- */
  const [mode, setMode] = useState<'light' | 'dark'>(() => getInitialAppearance().mode);
  const [activePalette, setActivePalette] = useState<PaletteId>(() => getInitialAppearance().palette);

  /* ----- Discussion storage ----- */
  const [chatStorage, setChatStorage] = useState<ChatStorageSummary | null>(null);
  const [confirmChatCleanup, setConfirmChatCleanup] = useState<ChatCleanupMode | null>(null);
  const [cleaningChat, setCleaningChat] = useState(false);
  const [cleanupNotice, setCleanupNotice] = useState('');

  /* ----- Explorer node overrides (per network, localStorage) ----- */
  const [nodeDrafts, setNodeDrafts] = useState<Record<string, string>>({});
  const [nodeNotice, setNodeNotice] = useState('');

  /* ----- Load everything on mount ----- */
  useEffect(() => {
    trackProductEvent('settings_opened');
    (async () => {
      try {
        const [ci, activeLocalModel, cs, storageSummary, languagePreference] = await Promise.all([
          getAliceInstructions(),
          getActiveModelId(),
          getCustomServer(),
          chat.getSessionStorageSummary(),
          getResponseLanguagePreference(),
        ]);
        setInstructions(ci);
        setSavedInstructions(ci);
        setActiveModelState(activeLocalModel);
        setChatStorage(storageSummary);
        setResponseLanguageState(languagePreference);
        const isCustomConnected = !!cs && chat.backendType === 'custom';
        if (cs) {
          setCustomUrl(cs.url);
          setCustomModel(cs.model);
          setCustomApiKey(cs.apiKey ?? '');
          setCustomConnected(isCustomConnected);
        }
        if (desktopLocalFirst) {
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
        }
      } catch {
        /* ignore */
      }
    })();

    // Load Explorer node overrides from localStorage into the draft inputs.
    setNodeDrafts(
      Object.fromEntries(configurableNetworks().map(n => [n.id, getNodeOverride(n.id)])),
    );

    // Load appearance from localStorage
    const storedMode = localStorage.getItem('alice_theme_mode') as 'light' | 'dark' | null;
    const storedPalette = localStorage.getItem('alice_palette') as PaletteId | null;
    if (storedMode) setMode(storedMode);
    if (storedPalette && ALL_PALETTE_IDS.includes(storedPalette)) setActivePalette(storedPalette);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- Handlers ----- */

  const handleSaveInstructions = async () => {
    await setAliceInstructions(instructions);
    setSavedInstructions(instructions);
    chat.clearMessages();
  };

  const handleClearInstructions = async () => {
    setInstructions('');
    await setAliceInstructions('');
    setSavedInstructions('');
  };

  const handleCustomConnect = async () => {
    const config: CustomServerConfig = {
      url: customUrl.trim(),
      model: customModel.trim(),
      apiKey: customApiKey.trim() || undefined,
    };
    await setCustomServer(config);
    chat.setBackendType('custom');
    setCustomConnected(true);
  };

  const handleCustomDisconnect = async () => {
    await setCustomServer(null);
    setCustomConnected(false);
    if (desktopLocalFirst) {
      chat.setBackendType('local');
    } else {
      chat.setBackendType('cloud');
    }
  };

  const handleSaveNode = (networkId: string) => {
    setNodeOverride(networkId, nodeDrafts[networkId] ?? '');
    // Reflect the trimmed/cleared value back into the input.
    setNodeDrafts(prev => ({ ...prev, [networkId]: getNodeOverride(networkId) }));
    setNodeNotice('Node saved. New Explorer tabs use it.');
    setTimeout(() => setNodeNotice(''), 4000);
  };

  const handleResetNode = (networkId: string) => {
    setNodeOverride(networkId, '');
    setNodeDrafts(prev => ({ ...prev, [networkId]: '' }));
    setNodeNotice('Reset to the default endpoint.');
    setTimeout(() => setNodeNotice(''), 4000);
  };

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

  const handleInstallLocalModel = async (id: LocalModelId) => {
    setSelectedLocalModel(null);
    setLocalDownloadOpen(false);
    setLocalModelStates(prev => ({ ...prev, [id]: { status: 'downloading', downloadProgress: 0 } }));
    try {
      await installDesktopModel(id, progress => {
        setLocalModelStates(prev => ({ ...prev, [id]: { status: 'downloading', downloadProgress: progress } }));
      });
      setLocalModelStates(prev => ({ ...prev, [id]: { status: 'installed', downloadProgress: null } }));
      await handleActivateLocalModel(id);
    } catch (error) {
      console.warn('[settings] desktop model install failed:', error);
      setLocalModelStates(prev => ({ ...prev, [id]: { status: 'not-installed', downloadProgress: null } }));
    }
  };

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

  const handleDeleteAllLocalModels = async () => {
    await deleteAllDesktopModels();
    await refreshDesktopModelStates();
  };

  const handleResetDefaults = async () => {
    await Promise.all([
      setPreset('local', 'balanced'),
      setPreset('cloud', 'balanced'),
      setAliceInstructions(''),
      setResponseLanguagePreference('auto'),
      setActiveCloudModelId('alice-cloud'),
      setActiveModelId('qwen3-0.6b'),
      setCustomServer(null),
    ]);
    setInstructions('');
    setSavedInstructions('');
    setResponseLanguageState('auto');
    setActiveModelState('qwen3-0.6b');
    setCustomUrl('');
    setCustomModel('');
    setCustomApiKey('');
    setCustomConnected(false);
    setLocalDownloadOpen(false);
    chat.setAiEnabled(true);
    chat.setBackendEnabled('local', true);
    chat.setBackendEnabled('cloud', true);
    chat.setBackendEnabled('custom', true);
    chat.setBackendType(desktopLocalFirst ? 'local' : 'cloud');
    chat.clearMessages();
  };

  const handleChatCleanup = async (mode: ChatCleanupMode) => {
    setCleaningChat(true);
    setCleanupNotice('');
    try {
      const result = await chat.cleanSessionHistory(mode);
      setChatStorage(await chat.getSessionStorageSummary());
      setCleanupNotice(
        `${result.deletedCount} conversation${result.deletedCount === 1 ? '' : 's'} deleted.`,
      );
    } catch (error) {
      console.warn('[settings] chat cleanup failed:', error);
      setCleanupNotice('Unable to clean discussion history.');
    } finally {
      setCleaningChat(false);
      setConfirmChatCleanup(null);
    }
  };

  /* ----- Appearance handlers ----- */

  const applyTheme = useCallback((newMode: 'light' | 'dark', newPalette: PaletteId) => {
    localStorage.setItem('alice_theme_mode', newMode);
    localStorage.setItem('alice_palette', newPalette);
    const colors = PALETTES[newPalette][newMode];
    const root = document.documentElement;
    root.style.setProperty('--alice-bg', colors.background);
    root.style.setProperty('--alice-bg-soft', colors.backgroundSoft);
    root.style.setProperty('--alice-primary', colors.primary);
    root.style.setProperty('--alice-primary-dark', colors.primaryDark);
    root.style.setProperty('--alice-text', colors.text);
    root.style.setProperty('--alice-border', colors.border);
    root.style.setProperty('--alice-muted', colors.muted);
    root.style.setProperty('--alice-card-bg', colors.cardBg);
    root.style.setProperty('--alice-on-primary', colors.onPrimary);
    root.style.setProperty('--alice-chat-bg', colors.primary);
    root.style.setProperty('--alice-chat-ink', colors.onPrimary);
    const [r, g, b] = [
      parseInt(colors.onPrimary.slice(1, 3), 16),
      parseInt(colors.onPrimary.slice(3, 5), 16),
      parseInt(colors.onPrimary.slice(5, 7), 16),
    ];
    root.style.setProperty('--alice-chat-ink-muted', `rgba(${r}, ${g}, ${b}, 0.7)`);
    root.style.setProperty('--alice-chat-field-border', `rgba(${r}, ${g}, ${b}, 0.3)`);
  }, []);

  useEffect(() => {
    applyTheme(mode, activePalette);
  }, [mode, activePalette, applyTheme]);

  const handleSelectPalette = useCallback(
    (id: PaletteId) => {
      setActivePalette(id);
      applyTheme(mode, id);
    },
    [mode, applyTheme],
  );

  const handleToggleMode = useCallback(() => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    applyTheme(next, activePalette);
  }, [mode, activePalette, applyTheme]);

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
  const instructionsChanged = instructions !== savedInstructions;
  const chatCleanupCount = confirmChatCleanup === 'all'
    ? (chatStorage?.count ?? 0)
    : confirmChatCleanup === 'oldest-10'
      ? Math.min(10, chatStorage?.count ?? 0)
      : Math.max(0, (chatStorage?.count ?? 0) - 10);

  /* ------------------------------------------------------------------ */
  /*  Render                                                             */
  /* ------------------------------------------------------------------ */

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: 'var(--alice-bg)', color: 'var(--alice-text)' }}
    >
      {isTauriDesktop() && (
        <div data-tauri-drag-region className="shrink-0" style={{ height: 28 }} />
      )}

      {/* Header */}
      <header className="flex items-center px-5 h-12 shrink-0">
        <button
          onClick={() => router.push('/')}
          className="font-pixel text-base bg-transparent border-none cursor-pointer p-0"
          style={{ color: 'var(--alice-text)', fontSize: 20 }}
          aria-label="Back"
        >
          &larr;
        </button>
        <h1
          className="font-pixel tracking-widest flex-1 text-center m-0"
          style={{ fontSize: 16 }}
        >
          SETTINGS
        </h1>
        <div className="w-9" />
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-12">
        <div className="max-w-2xl mx-auto">

          {/* ============================================ */}
          {/*  CUSTOMIZE ALICE                             */}
          {/* ============================================ */}
          <h2
            className="font-pixel tracking-widest mt-6 mb-4"
            style={{ fontSize: 8, opacity: 0.7 }}
          >
            CUSTOMIZE ALICE
          </h2>

          <div style={sectionStyle}>
            <div className="flex items-center justify-between gap-4">
              <SectionLabel>LOCAL AI</SectionLabel>
              <PixelSwitch
                label="Local AI"
                enabled={chat.localAvailable && chat.backendEnabled.local}
                onChange={enabled => chat.setBackendEnabled('local', enabled)}
                disabled={!chat.localAvailable}
              />
            </div>
            <div style={{ height: 1, backgroundColor: 'var(--alice-border)', margin: '12px 0' }} />
            <div className="flex items-center justify-between gap-4">
              <SectionLabel>PRIVATE CLOUD</SectionLabel>
              <PixelSwitch
                label="Private Cloud AI"
                enabled={chat.backendEnabled.cloud}
                onChange={enabled => chat.setBackendEnabled('cloud', enabled)}
              />
            </div>
          </div>

          {/* 1. ALICE INSTRUCTIONS */}
          <div style={sectionStyle}>
            <SectionLabel>ALICE INSTRUCTIONS</SectionLabel>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={4}
              className="w-full font-numbers resize-vertical outline-none mt-2"
              style={{
                fontSize: 15,
                padding: 12,
                backgroundColor: 'var(--alice-bg)',
                border: '2px solid var(--alice-primary)',
                borderRadius: 2,
                color: 'var(--alice-primary-dark)',
                boxSizing: 'border-box',
              }}
              placeholder="Tell Alice how to behave, what topics to focus on, preferred language..."
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleSaveInstructions}
                className="font-pixel tracking-widest"
                style={{
                  ...btnBase,
                  backgroundColor: instructionsChanged ? 'var(--alice-primary)' : 'transparent',
                  color: instructionsChanged ? 'var(--alice-on-primary)' : 'var(--alice-primary)',
                  opacity: instructionsChanged ? 1 : 0.5,
                }}
                disabled={!instructionsChanged}
              >
                SAVE INSTRUCTIONS
              </button>
              {instructions.length > 0 && (
                <button
                  onClick={handleClearInstructions}
                  className="font-pixel tracking-widest"
                  style={{
                    ...btnBase,
                    backgroundColor: 'transparent',
                    color: '#e06060',
                    borderColor: '#e06060',
                  }}
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>

          <div style={sectionStyle}>
            <SectionLabel>RESPONSE LANGUAGE</SectionLabel>
            <p className="font-numbers m-0 mt-1 mb-3" style={{ fontSize: 14, opacity: 0.6 }}>
              Auto follows your latest message. A fixed choice overrides automatic detection.
            </p>
            <div className="flex gap-2 flex-wrap" role="group" aria-label="Alice response language">
              {([
                ['auto', 'AUTO'],
                ['fr', 'FRANCAIS'],
                ['en', 'ENGLISH'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={responseLanguage === value}
                  className="font-pixel tracking-widest"
                  style={{
                    ...btnBase,
                    backgroundColor: responseLanguage === value ? 'var(--alice-primary)' : 'transparent',
                    color: responseLanguage === value ? 'var(--alice-on-primary)' : 'var(--alice-primary)',
                  }}
                  onClick={async () => {
                    setResponseLanguageState(value);
                    await setResponseLanguagePreference(value);
                    chat.clearMessages();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 4. LOCAL MODEL */}
          <div style={sectionStyle}>
            <SectionLabel>LOCAL MODELS</SectionLabel>
            {isTauriDesktop() ? (
              <>
                <p className="font-numbers m-0 mt-1 mb-3" style={{ fontSize: 14, opacity: 0.5 }}>
                  Same local model catalog as Alice mobile. Gemma 3 1B is built in; larger models can be downloaded on this device.
                </p>
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
                              <span className="font-pixel tracking-widest" style={{ fontSize: 8, color: 'var(--alice-primary-dark)' }}>
                                {model.name}
                              </span>
                              <span className="font-pixel tracking-widest" style={{ fontSize: 8, opacity: 0.45 }}>
                                {formatSize(model.sizeBytes)}
                              </span>
                            </div>
                            <p className="font-numbers m-0 mt-1" style={{ fontSize: 14, opacity: 0.65, lineHeight: '18px' }}>
                              {model.description}
                            </p>
                            <div className="flex gap-2 mt-2 flex-wrap">
                              {active && <span className="font-pixel tracking-widest" style={{ fontSize: 8, color: 'var(--alice-primary)' }}>ACTIVE</span>}
                              {installed && <span className="font-pixel tracking-widest" style={{ fontSize: 8, opacity: 0.55 }}>INSTALLED</span>}
                              {!installed && !downloading && <span className="font-pixel tracking-widest" style={{ fontSize: 8, opacity: 0.45 }}>NOT INSTALLED</span>}
                              <span className="font-pixel tracking-widest" style={{ fontSize: 8, opacity: 0.45 }}>{model.ramNeeded}</span>
                            </div>
                            <p className="font-numbers m-0 mt-2" style={{ fontSize: 13, opacity: 0.45 }}>
                              {downloading ? 'Downloading...' : 'Open details'}
                            </p>
                            {downloading && (
                              <div className="flex items-center gap-2 mt-2">
                                <div style={{ height: 6, flex: 1, border: '1px solid var(--alice-border)' }}>
                                  <div style={{ height: '100%', width: `${progress}%`, backgroundColor: 'var(--alice-primary)' }} />
                                </div>
                                <span className="font-pixel" style={{ fontSize: 8, opacity: 0.7 }}>{progress}%</span>
                              </div>
                            )}
                          </div>
                          <span className="font-pixel tracking-widest shrink-0" style={{ fontSize: 8, opacity: 0.5 }}>
                            {downloading ? '' : '>'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {installedLocalModels.length === 0 && (
                    <div style={{ padding: 12 }}>
                      <span className="font-pixel tracking-widest" style={{ fontSize: 8, opacity: 0.55 }}>
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
                  <span style={{ fontSize: 8 }}>{localDownloadOpen ? '▲' : '▼'}</span>
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
                        <span className="font-pixel tracking-widest" style={{ fontSize: 8 }}>
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
                    onClick={handleDeleteAllLocalModels}
                    className="font-pixel tracking-widest"
                    style={{
                      ...btnBase,
                      backgroundColor: 'transparent',
                      color: '#e06060',
                      borderColor: '#e06060',
                    }}
                  >
                    DELETE ALL
                  </button>
                </div>
              </>
            ) : (
              <p className="font-numbers m-0 mt-2" style={{ fontSize: 15, opacity: 0.7 }}>
                Install the Alice Wallet app to use local AI models on your device.
              </p>
            )}
          </div>

          {/* PRIVATE CLOUD */}
          <div style={sectionStyle}>
            <SectionLabel>PRIVATE CLOUD</SectionLabel>
            <p className="font-numbers m-0 mt-1" style={{ fontSize: 14, opacity: 0.5 }}>
              Alice processes your message on servers Alice operates. Your messages leave this device.
              Your seed phrase, private keys, addresses, balances and full transaction history are never
              sent automatically. Private Cloud is not the same as running Alice on your device — for that,
              use a local model.
            </p>
            <p className="font-numbers m-0 mt-2" style={{ fontSize: 14, opacity: 0.5 }}>
              The brain button in the chat sends a single message to a stronger model. It is slower and
              only available on Private Cloud.
            </p>

            <details className="mt-3">
              <summary
                className="font-pixel tracking-widest cursor-pointer"
                style={{ fontSize: 8, opacity: 0.6, listStyle: 'revert' }}
              >
                TECHNICAL DETAILS
              </summary>
              {/* Read-only on purpose: the model is a consequence of the mode and
                  the brain button, never a user-facing choice. */}
              <div
                className="font-numbers mt-2"
                style={{
                  fontSize: 14,
                  opacity: 0.6,
                  padding: '10px 12px',
                  backgroundColor: 'var(--alice-bg)',
                  border: '2px solid var(--alice-border)',
                  borderRadius: 2,
                }}
              >
                <div>Standard answers: {CLOUD_MODELS[0].veniceId}</div>
                <div className="mt-1">Deeper answers: {CLOUD_DEEP_MODEL}</div>
                <div className="mt-1">Provider: Venice Private Cloud</div>
                <p className="m-0 mt-2" style={{ opacity: 0.8 }}>
                  Alice may change these models to improve quality or cost. The commitments above do not
                  change with the model.
                </p>
              </div>
            </details>
          </div>

          {/* 3. CUSTOM SERVER */}
          <div style={sectionStyle}>
            <div className="flex items-start justify-between gap-4">
              <SectionLabel>CUSTOM SERVER</SectionLabel>
              <PixelSwitch
                label="Custom server AI"
                enabled={chat.backendEnabled.custom}
                onChange={enabled => chat.setBackendEnabled('custom', enabled)}
              />
            </div>
            <p
              className="font-numbers m-0 mt-1 mb-3"
              style={{ fontSize: 14, opacity: 0.5 }}
            >
                Advanced option: connect to an OpenAI-compatible or Ollama server. Prompts may leave this device if the server is remote.
            </p>
            <div className="flex flex-col gap-2">
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="Server URL (e.g. http://localhost:11434/v1)"
                className="font-numbers outline-none w-full"
                style={{
                  fontSize: 15,
                  padding: '8px 12px',
                  backgroundColor: 'var(--alice-bg)',
                  border: '2px solid var(--alice-primary)',
                  borderRadius: 2,
                  color: 'var(--alice-primary-dark)',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Model name (e.g. llama3)"
                className="font-numbers outline-none w-full"
                style={{
                  fontSize: 15,
                  padding: '8px 12px',
                  backgroundColor: 'var(--alice-bg)',
                  border: '2px solid var(--alice-primary)',
                  borderRadius: 2,
                  color: 'var(--alice-primary-dark)',
                  boxSizing: 'border-box',
                }}
              />
              <input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="API key (optional)"
                className="font-numbers outline-none w-full"
                style={{
                  fontSize: 15,
                  padding: '8px 12px',
                  backgroundColor: 'var(--alice-bg)',
                  border: '2px solid var(--alice-primary)',
                  borderRadius: 2,
                  color: 'var(--alice-primary-dark)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div className="flex gap-2 mt-3">
              {!customConnected ? (
                <button
                  onClick={handleCustomConnect}
                  className="font-pixel tracking-widest"
                  style={{
                    ...btnBase,
                    backgroundColor:
                      customUrl.trim() && customModel.trim()
                        ? 'var(--alice-primary)'
                        : 'transparent',
                    color:
                      customUrl.trim() && customModel.trim()
                        ? 'var(--alice-on-primary)'
                        : 'var(--alice-primary)',
                    opacity: customUrl.trim() && customModel.trim() ? 1 : 0.5,
                  }}
                  disabled={!customUrl.trim() || !customModel.trim()}
                >
                  SAVE AND CONNECT
                </button>
              ) : (
                <button
                  onClick={handleCustomDisconnect}
                  className="font-pixel tracking-widest"
                  style={{
                    ...btnBase,
                    backgroundColor: 'transparent',
                    color: '#e06060',
                    borderColor: '#e06060',
                  }}
                >
                  DISCONNECT
                </button>
              )}
            </div>
          </div>

          {/* DISCUSSION STORAGE */}
          <div style={sectionStyle}>
            <SectionLabel>CLEAN YOUR DISCUSSION HISTORY</SectionLabel>
            <div className="flex items-center justify-between gap-3 mt-2">
              <span className="font-pixel tracking-widest" style={{ fontSize: 8 }}>
                {chatStorage?.count ?? 0} / {MAX_CHAT_SESSIONS} CONVERSATIONS
              </span>
              <span className="font-pixel tracking-widest" style={{ fontSize: 7, opacity: 0.55 }}>
                {formatStorageSize(chatStorage?.estimatedBytes ?? 0)}
              </span>
            </div>
            <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, lineHeight: '19px', opacity: 0.65 }}>
              Conversations stay on this device. Alice keeps at most 50 and removes the oldest when the limit is reached.
            </p>
            <p className="font-pixel tracking-widest m-0 mt-2" style={{ fontSize: 7, color: 'var(--alice-primary-dark)' }}>
              {desktopLocalFirst
                ? 'ENCRYPTED WITH THIS DEVICE’S SYSTEM KEYCHAIN'
                : 'STORED LOCALLY IN THIS BROWSER'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
              <button
                onClick={() => setConfirmChatCleanup('oldest-10')}
                className="font-pixel tracking-widest"
                style={{
                  ...btnBase,
                  backgroundColor: 'transparent',
                  color: 'var(--alice-primary)',
                  opacity: (chatStorage?.count ?? 0) === 0 ? 0.4 : 1,
                }}
                disabled={(chatStorage?.count ?? 0) === 0 || cleaningChat}
              >
                DELETE 10 OLDEST
              </button>
              <button
                onClick={() => setConfirmChatCleanup('keep-newest-10')}
                className="font-pixel tracking-widest"
                style={{
                  ...btnBase,
                  backgroundColor: 'transparent',
                  color: 'var(--alice-primary)',
                  opacity: (chatStorage?.count ?? 0) <= 10 ? 0.4 : 1,
                }}
                disabled={(chatStorage?.count ?? 0) <= 10 || cleaningChat}
              >
                KEEP 10 NEWEST
              </button>
              <button
                onClick={() => setConfirmChatCleanup('all')}
                className="font-pixel tracking-widest"
                style={{
                  ...btnBase,
                  backgroundColor: 'transparent',
                  color: '#e06060',
                  borderColor: '#e06060',
                  opacity: (chatStorage?.count ?? 0) === 0 ? 0.4 : 1,
                }}
                disabled={(chatStorage?.count ?? 0) === 0 || cleaningChat}
              >
                DELETE ALL
              </button>
            </div>
            {cleanupNotice && (
              <p className="font-numbers m-0 mt-3" style={{ fontSize: 14, opacity: 0.7 }}>
                {cleanupNotice}
              </p>
            )}
          </div>

          {/* 7. RESET TO DEFAULT */}
          <button
            onClick={handleResetDefaults}
            className="font-pixel tracking-widest w-full mb-8"
            style={{
              ...btnBase,
              padding: '10px 16px',
              backgroundColor: 'transparent',
              color: '#e06060',
              borderColor: '#e06060',
            }}
          >
            RESET TO DEFAULT
          </button>

          {/* ============================================ */}
          {/*  EXPLORER                                 */}
          {/* ============================================ */}
          <h2
            className="font-pixel tracking-widest mb-4"
            style={{ fontSize: 8, opacity: 0.7 }}
          >
            EXPLORER
          </h2>

          <div style={sectionStyle}>
            <SectionLabel>DATA NODE</SectionLabel>
            <p
              className="font-numbers m-0 mt-1 mb-3"
              style={{ fontSize: 14, opacity: 0.5 }}
            >
              Explorer reads the chain through an Esplora / mempool endpoint. The public defaults rate-limit heavy analysis; point a network at your own node for unthrottled, private queries. Leave blank to use the default.
            </p>
            <div className="flex flex-col gap-4">
              {configurableNetworks().map((net) => {
                const draft = nodeDrafts[net.id] ?? '';
                const defaultUrl = getNetwork(net.id).baseUrl ?? '';
                const dirty = draft.trim().replace(/\/$/, '') !== getNodeOverride(net.id);
                return (
                  <div key={net.id} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: net.color, display: 'inline-block' }}
                      />
                      <span className="font-pixel tracking-widest" style={{ fontSize: 7 }}>
                        {net.label.toUpperCase()}
                      </span>
                      {getNodeOverride(net.id) && (
                        <span className="font-pixel tracking-widest" style={{ fontSize: 6, opacity: 0.6 }}>
                          / CUSTOM
                        </span>
                      )}
                    </div>
                    <input
                      type="url"
                      value={draft}
                      onChange={(e) => setNodeDrafts(prev => ({ ...prev, [net.id]: e.target.value }))}
                      placeholder={defaultUrl}
                      className="font-numbers outline-none w-full"
                      style={{
                        fontSize: 15,
                        padding: '8px 12px',
                        backgroundColor: 'var(--alice-bg)',
                        border: '2px solid var(--alice-primary)',
                        borderRadius: 2,
                        color: 'var(--alice-primary-dark)',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveNode(net.id)}
                        className="font-pixel tracking-widest"
                        disabled={!dirty}
                        style={{
                          ...btnBase,
                          backgroundColor: dirty ? 'var(--alice-primary)' : 'transparent',
                          color: dirty ? 'var(--alice-on-primary)' : 'var(--alice-primary)',
                          opacity: dirty ? 1 : 0.5,
                        }}
                      >
                        SAVE
                      </button>
                      {getNodeOverride(net.id) && (
                        <button
                          onClick={() => handleResetNode(net.id)}
                          className="font-pixel tracking-widest"
                          style={{ ...btnBase, backgroundColor: 'transparent', color: 'var(--alice-primary)' }}
                        >
                          DEFAULT
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {nodeNotice && (
              <p className="font-numbers m-0 mt-3" style={{ fontSize: 13, opacity: 0.7 }}>
                {nodeNotice}
              </p>
            )}
          </div>

          <BalanceUnitSection />

          {/* ============================================ */}
          {/*  APPEARANCE                                  */}
          {/* ============================================ */}
          <h2
            className="font-pixel tracking-widest mb-4"
            style={{ fontSize: 8, opacity: 0.7 }}
          >
            APPEARANCE
          </h2>

          <div style={sectionStyle}>
            {/* Pixel wheel */}
            <div className="flex justify-center">
              <PixelWheel
                activePalette={activePalette}
                mode={mode}
                onSelectPalette={handleSelectPalette}
                onToggleMode={handleToggleMode}
              />
            </div>

            {/* Labels under the wheel */}
            <div
              className="flex justify-between items-center mt-4 px-2"
            >
              <span
                className="font-pixel tracking-widest"
                style={{ fontSize: 7 }}
              >
                {mode === 'dark' ? '●' : '○'} {mode.toUpperCase()}
              </span>
              <span
                className="font-pixel tracking-widest"
                style={{ fontSize: 7 }}
              >
                {PALETTES[activePalette].label.toUpperCase()}
              </span>
            </div>

            <p
              className="font-numbers text-center m-0 mt-3"
              style={{ fontSize: 14, opacity: 0.5 }}
            >
              Tap center to toggle theme / Tap the ring to change color
            </p>
          </div>

          {/* Bottom spacing */}
          <div className="h-8" />
        </div>
      </div>

      {selectedLocalModelEntry && selectedLocalModelState && (
        <div
          className="fixed inset-0 flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }}
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
                <p className="font-pixel tracking-widest m-0 mt-2" style={{ fontSize: 8, opacity: 0.55 }}>
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
                <p className="font-pixel tracking-widest m-0" style={{ fontSize: 8, opacity: 0.55 }}>SPEED</p>
                <p className="font-numbers m-0 mt-2" style={{ fontSize: 14 }}>{selectedLocalModelEntry.speed}</p>
              </div>
              <div style={{ border: '1px solid var(--alice-border)', padding: 10 }}>
                <p className="font-pixel tracking-widest m-0" style={{ fontSize: 8, opacity: 0.55 }}>RAM NEEDED</p>
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
                  style={{ ...btnBase, color: '#e06060', borderColor: '#e06060', backgroundColor: 'transparent' }}
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

      {confirmChatCleanup && (
        <div
          className="fixed inset-0 flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }}
          onClick={() => !cleaningChat && setConfirmChatCleanup(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              ...sectionStyle,
              marginBottom: 0,
              maxWidth: 420,
              width: '100%',
              backgroundColor: 'var(--alice-bg)',
            }}
          >
            <h3 className="font-pixel tracking-widest m-0" style={{ fontSize: 10, color: '#e06060' }}>
              DELETE CONVERSATIONS
            </h3>
            <p className="font-numbers m-0 mt-3" style={{ fontSize: 15, lineHeight: '20px', opacity: 0.8 }}>
              Delete {chatCleanupCount} conversation{chatCleanupCount === 1 ? '' : 's'} from this device? This cannot be undone.
            </p>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setConfirmChatCleanup(null)}
                className="font-pixel tracking-widest flex-1"
                style={{ ...btnBase, backgroundColor: 'transparent' }}
                disabled={cleaningChat}
              >
                CANCEL
              </button>
              <button
                onClick={() => void handleChatCleanup(confirmChatCleanup)}
                className="font-pixel tracking-widest flex-1"
                style={{
                  ...btnBase,
                  backgroundColor: '#e06060',
                  color: '#ffffff',
                  borderColor: '#e06060',
                }}
                disabled={cleaningChat}
              >
                {cleaningChat ? 'DELETING...' : 'DELETE'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
