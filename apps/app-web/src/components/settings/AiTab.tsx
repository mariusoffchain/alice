'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_LOCAL_MODEL_ID,
  type CustomServerConfig,
  CLOUD_MODELS,
  setPreset,
  getAliceInstructions,
  setAliceInstructions,
  setResponseLanguagePreference,
  setActiveModelId,
  setActiveCloudModelId,
  getCustomServer,
  setCustomServer,
  isTauriDesktop,
  useChat,
} from '@alice-wallet/alice-ai';
import { SvgIcon } from '@/components/SvgIcon';
import { CHEVRON_RIGHT_ICON } from '@/lib/atelier-icons';
import { LocalModelsSection } from './LocalModelsSection';
import { SemanticSearchSection } from './SemanticSearchSection';
import { AliceMemoryPanel } from './AliceMemoryPanel';
import {
  ConfirmDialog,
  inputStyle,
  PixelSwitch,
  SectionHint,
  SectionLabel,
  sectionStyle,
} from './ui';

export function AiTab() {
  // The AI tab hosts a sub-screen: the memory panel replaces the tab body in
  // place, staying inside the settings frame instead of navigating away.
  const [screen, setScreen] = useState<'main' | 'memory'>('main');
  const chat = useChat();
  const desktopLocalFirst = isTauriDesktop();

  const [instructions, setInstructions] = useState('');
  const [savedInstructions, setSavedInstructions] = useState('');

  const [customUrl, setCustomUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customConnected, setCustomConnected] = useState(false);

  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [ci, cs] = await Promise.all([getAliceInstructions(), getCustomServer()]);
        setInstructions(ci);
        setSavedInstructions(ci);
        if (cs) {
          setCustomUrl(cs.url);
          setCustomModel(cs.model);
          setCustomApiKey(cs.apiKey ?? '');
          setCustomConnected(chat.backendType === 'custom');
        }
      } catch {
        /* ignore */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    chat.setBackendType(desktopLocalFirst ? 'local' : 'cloud');
  };

  const handleResetDefaults = async () => {
    await Promise.all([
      setPreset('local', 'balanced'),
      setPreset('cloud', 'balanced'),
      setAliceInstructions(''),
      setResponseLanguagePreference('auto'),
      setActiveCloudModelId('alice-cloud'),
      setActiveModelId(DEFAULT_LOCAL_MODEL_ID),
      setCustomServer(null),
    ]);
    setInstructions('');
    setSavedInstructions('');
    setCustomUrl('');
    setCustomModel('');
    setCustomApiKey('');
    setCustomConnected(false);
    chat.setAiEnabled(true);
    chat.setBackendEnabled('local', true);
    chat.setBackendEnabled('cloud', true);
    chat.setBackendEnabled('custom', true);
    chat.setBackendType(desktopLocalFirst ? 'local' : 'cloud');
    chat.clearMessages();
    setConfirmReset(false);
  };

  const instructionsChanged = instructions !== savedInstructions;
  const customReady = !!customUrl.trim() && !!customModel.trim();

  if (screen === 'memory') {
    return <AliceMemoryPanel onBack={() => setScreen('main')} />;
  }

  return (
    <>
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
        {!chat.localAvailable && (
          <p className="font-numbers m-0 mt-2" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
            {/* A switch that can never be turned on is a question with no
                answer. Say where the answer lives instead. */}
            Local AI runs in the Alice apps, not in a browser tab.{' '}
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
        <div style={{ height: 12 }} />
        <div className="flex items-center justify-between gap-4">
          <SectionLabel>PRIVATE CLOUD</SectionLabel>
          <PixelSwitch
            label="Private Cloud AI"
            enabled={chat.backendEnabled.cloud}
            onChange={enabled => chat.setBackendEnabled('cloud', enabled)}
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <SectionLabel>PERSONALIZATION</SectionLabel>
        {/* The page has existed all along; no screen led to it, which is why
            the memory read as a wallet-only feature. Same entry and words as
            the mobile app, so the two describe one feature. */}
        <button
          type="button"
          onClick={() => setScreen('memory')}
          className="alice-control alice-control--quiet font-numbers mt-2 flex w-full items-center justify-between gap-4 cursor-pointer text-left"
        >
          <span className="flex flex-col gap-1">
            <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-primary)' }}>ALICE MEMORY</span>
            <span className="font-numbers" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>
              See and control what Alice remembers locally.
            </span>
          </span>
          <SvgIcon svg={CHEVRON_RIGHT_ICON} size={16} color="currentColor" />
        </button>
      </div>

      <div style={sectionStyle}>
        <SectionLabel>ALICE INSTRUCTIONS</SectionLabel>
        <label className="alice-field-label mt-3" htmlFor="alice-instructions">Instructions for Alice</label>
        <textarea
          id="alice-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={4}
          className="alice-field w-full font-numbers resize-vertical outline-none mt-2"
          style={{ ...inputStyle, padding: 12 }}
          placeholder="Tell Alice how to behave, what topics to focus on, preferred language..."
        />
        <p className="font-numbers text-sm mt-2" role="status" style={{ color: 'var(--alice-muted)' }}>{instructionsChanged ? 'Unsaved instructions' : 'Instructions saved on this device'}</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleSaveInstructions}
            className="alice-control alice-control--primary font-numbers"
            disabled={!instructionsChanged}
          >
            SAVE INSTRUCTIONS
          </button>
          {instructions.length > 0 && (
            <button
              onClick={handleClearInstructions}
              className="alice-control alice-control--danger font-numbers"
            >
              CLEAR
            </button>
          )}
        </div>
      </div>

      <LocalModelsSection />

      <SemanticSearchSection />

      <div style={sectionStyle}>
        <SectionLabel>PRIVATE CLOUD</SectionLabel>
        <p className="font-numbers m-0 mt-1" style={{ fontSize: 14, opacity: 1 }}>
          Alice processes your message on servers Alice operates. Your messages leave this device.
          Your seed phrase, private keys, addresses, balances and full transaction history are never
          sent automatically. Private Cloud is not the same as running Alice on your device: for that,
          use a local model.
        </p>

        <details className="mt-3">
          <summary
            className="font-numbers  cursor-pointer"
            style={{ fontSize: 13, opacity: 1, listStyle: 'revert' }}
          >
            TECHNICAL DETAILS
          </summary>
          {/* Read-only on purpose: Private Cloud has one provider model, while
              Light, Normal, and High adjust its reasoning budget. */}
          <div
            className="font-numbers mt-2"
            style={{
              fontSize: 14,
              opacity: 1,
              padding: '10px 12px',
              borderLeft: '2px solid var(--alice-border)',
            }}
          >
            <div>Standard answers: {CLOUD_MODELS[0].veniceId}</div>
            <div className="mt-1">Provider: Venice Private Cloud</div>
            <p className="m-0 mt-2" style={{ opacity: 1 }}>
              Alice may change these models to improve quality or cost. The commitments above do not
              change with the model.
            </p>
          </div>
        </details>
      </div>

      <div style={sectionStyle}>
        <div className="flex items-start justify-between gap-4">
          <SectionLabel>CUSTOM SERVER</SectionLabel>
          <PixelSwitch
            label="Custom server AI"
            enabled={chat.backendEnabled.custom}
            onChange={enabled => chat.setBackendEnabled('custom', enabled)}
          />
        </div>
        <SectionHint>
          Advanced option: connect to an OpenAI-compatible or Ollama server. Prompts may leave this device if the server is remote.
        </SectionHint>
        <div className="flex flex-col gap-2">
          <label className="alice-field-label" htmlFor="alice-customUrl">Server URL</label>
          <input
            type="url"
            id="alice-customUrl"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="Server URL (e.g. http://localhost:11434/v1)"
            className="alice-field font-numbers outline-none w-full"
            style={inputStyle}
          />
          <label className="alice-field-label" htmlFor="alice-customModel">Model name</label>
          <input
            type="text"
            id="alice-customModel"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="Model name (e.g. llama3)"
            className="alice-field font-numbers outline-none w-full"
            style={inputStyle}
          />
          <label className="alice-field-label" htmlFor="alice-customApiKey">API key (optional)</label>
          <input
            type="password"
            id="alice-customApiKey"
            value={customApiKey}
            onChange={(e) => setCustomApiKey(e.target.value)}
            placeholder="API key (optional)"
            className="alice-field font-numbers outline-none w-full"
            style={inputStyle}
          />
        </div>
        <p className="font-numbers text-sm mt-3" role="status">{customConnected ? 'Connected to your custom server' : 'Custom server not connected'}</p>
        <div className="flex gap-2 mt-3">
          {!customConnected ? (
            <button
              onClick={handleCustomConnect}
              className="alice-control alice-control--primary font-numbers"
              disabled={!customReady}
            >
              SAVE AND CONNECT
            </button>
          ) : (
            <button
              onClick={handleCustomDisconnect}
              className="alice-control alice-control--danger font-numbers"
            >
              DISCONNECT
            </button>
          )}
        </div>
      </div>

      <button
        onClick={() => setConfirmReset(true)}
        className="alice-control alice-control--danger font-numbers w-full mb-4"
      >
        RESET TO DEFAULT
      </button>

      {confirmReset && (
        <ConfirmDialog
          title="RESET TO DEFAULT"
          body="Reset Alice instructions, response language, models and custom server to their defaults? Your conversations are kept."
          confirmLabel="RESET"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => void handleResetDefaults()}
        />
      )}
    </>
  );
}
