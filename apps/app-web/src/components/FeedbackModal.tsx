'use client';

import { type DragEvent, useEffect, useState } from 'react';
import {
  type AIPreset,
  CLOUD_MODELS,
  MODEL_CATALOG,
  getActiveCloudModelId,
  getActiveModelId,
  getCustomServer,
  getPreset,
  isTauriDesktop,
  useChat,
} from '@alice-wallet/alice-ai';
import { openExternalUrl } from '@/lib/open-external';
import appWebPackage from '../../package.json';
import appDesktopPackage from '../../../app-desktop/package.json';

// Dedicated public repo for community bug reports / knowledge suggestions,
// since the main `alice` repo is private. Revisit once `alice` goes public, // issues could move there directly instead of this separate repo.
const FEEDBACK_REPO = 'mariusoffchain/alice-support-contribute';
const FEEDBACK_EMAIL = 'report@alicebtc.com';

type Category = 'bug' | 'alice-response' | 'knowledge';

const CATEGORIES: { id: Category; label: string; placeholder: string }[] = [
  { id: 'bug', label: 'Bug report', placeholder: 'What happened, and what did you expect instead?' },
  { id: 'alice-response', label: 'Bad Alice response', placeholder: "What did Alice say that was wrong, unhelpful, or off? Paste the relevant part of the reply." },
  { id: 'knowledge', label: 'Knowledge suggestion', placeholder: 'What should Alice know about, or explain better?' },
];

const BACKEND_LABELS = {
  local: 'Local',
  cloud: 'Private Cloud',
  custom: 'Custom AI',
} as const;

const REASONING_LABELS: Record<AIPreset, string> = {
  fast: 'Short',
  balanced: 'Normal',
  deep: 'Detailed',
};

// What the report is allowed to know about the AI setup. Deliberately only
// settings: no message content, no custom server URL, no API key. A bad answer
// is described by the reporter in their own words, not harvested from the chat.
type AIReportContext = {
  model: string;
  preset: AIPreset;
};

interface FeedbackModalProps {
  onClose: () => void;
}

export function FeedbackModal({ onClose }: FeedbackModalProps) {
  const { backendType, backendStatus } = useChat();
  const [aiContext, setAiContext] = useState<AIReportContext | null>(null);
  const [category, setCategory] = useState<Category>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);

  const active = CATEGORIES.find(c => c.id === category)!;
  const summary = title.trim() || active.label;
  const trimmedDescription = description.trim();

  useEffect(() => {
    return () => {
      if (screenshotPreview) {
        URL.revokeObjectURL(screenshotPreview);
      }
    };
  }, [screenshotPreview]);

  useEffect(() => {
    let cancelled = false;
    // Custom reads the cloud preset key, same as ai-backend-custom does, so the
    // report shows the preset that actually applied rather than a guess.
    const presetKey = backendType === 'local' ? 'local' : 'cloud';
    (async () => {
      const [preset, model] = await Promise.all([
        getPreset(presetKey),
        (async () => {
          if (backendType === 'cloud') {
            const id = await getActiveCloudModelId();
            return CLOUD_MODELS.find(m => m.id === id)?.name ?? 'Private Cloud';
          }
          if (backendType === 'custom') {
            const server = await getCustomServer();
            return server?.model || 'Unknown';
          }
          const id = await getActiveModelId();
          return MODEL_CATALOG.find(m => m.id === id)?.name ?? 'Unknown';
        })(),
      ]);
      if (!cancelled) setAiContext({ preset, model });
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [backendType]);

  const buildReportBody = () => {
    const lines = [
      `Category: ${active.label}`,
      `Summary: ${summary}`,
      '',
      'Description:',
      trimmedDescription,
      '',
      'Context:',
      `- App: ${isTauriDesktop() ? 'Desktop' : 'Web'} v${isTauriDesktop() ? appDesktopPackage.version : appWebPackage.version}`,
      `- AI mode: ${BACKEND_LABELS[backendType]}`,
      // Private Cloud has a single model of the same name, so a Model line there
      // would just repeat the mode. Only say it when it adds something.
      aiContext && aiContext.model !== BACKEND_LABELS[backendType] ? `- Model: ${aiContext.model}` : '',
      `- Reasoning: ${aiContext ? REASONING_LABELS[aiContext.preset] : 'Unknown'}`,
      `- Backend status: ${backendStatus.state}`,
      `- URL: ${typeof window !== 'undefined' ? window.location.href : 'Unknown'}`,
      `- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`,
      `- Screenshot selected: ${screenshot ? screenshot.name : 'No'}`,
      '',
      screenshot ? 'If relevant, attach the selected screenshot manually when sending this report.' : '',
      screenshot ? '' : '',
      'Safety reminder:',
      'Do not include seed phrases, private keys, or sensitive screenshots.',
    ].filter(Boolean);
    return lines.join('\n');
  };

  const copyText = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  const handleCopy = async () => {
    await copyText(buildReportBody());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleEmail = async () => {
    const subject = encodeURIComponent(`[Alice beta report] ${summary}`);
    const body = encodeURIComponent(buildReportBody());
    await openExternalUrl(`mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`);
  };

  const handleScreenshotChange = (file: File | null) => {
    if (file && !file.type.startsWith('image/')) {
      return;
    }

    if (screenshotPreview) {
      URL.revokeObjectURL(screenshotPreview);
    }

    setScreenshot(file);
    setScreenshotPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleScreenshotChange(event.dataTransfer.files?.[0] ?? null);
  };

  const handleSubmit = async () => {
    const url = new URL(`https://github.com/${FEEDBACK_REPO}/issues/new`);
    url.searchParams.set('title', summary);
    url.searchParams.set('body', buildReportBody());
    url.searchParams.set('labels', `${category},private-beta`);
    await openExternalUrl(url.toString());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: 'min(92vh, 760px)',
          overflowY: 'auto',
          padding: 18,
          backgroundColor: 'var(--alice-bg)',
          border: '2px solid var(--alice-border)',
          borderRadius: 2,
          color: 'var(--alice-text)',
        }}
      >
        <h3
          className="font-pixel tracking-widest m-0"
          style={{ fontSize: 16, color: 'var(--alice-primary-dark)' }}
        >
          REPORT
        </h3>
        <p
          className="font-numbers m-0 mt-2"
          style={{ fontSize: 15, lineHeight: '19px', opacity: 0.7 }}
        >
          Report a bug, flag a bad Alice response, or suggest something Alice should know. You can copy the report, email it, or continue on GitHub.
        </p>
        <p
          className="font-numbers m-0 mt-2"
          style={{ fontSize: 14, lineHeight: '17px', color: 'var(--alice-primary-dark)' }}
        >
          Never include your seed phrase, private keys, or sensitive screenshots.
        </p>

        <div className="flex gap-1.5 mt-4">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className="flex-1 font-numbers cursor-pointer"
              style={{
                fontSize: 13,
                lineHeight: '14px',
                padding: '8px 6px',
                border: `2px solid ${category === c.id ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
                borderRadius: 2,
                backgroundColor: category === c.id ? 'var(--alice-card-bg)' : 'transparent',
                color: category === c.id ? 'var(--alice-primary)' : 'var(--alice-text)',
                opacity: category === c.id ? 1 : 0.7,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short summary"
          maxLength={120}
          className="w-full font-numbers outline-none mt-3"
          style={{
            height: 36,
            fontSize: 15,
            padding: '0 10px',
            color: 'var(--alice-text)',
            backgroundColor: 'var(--alice-bg-soft)',
            border: '1px solid var(--alice-border)',
            borderRadius: 2,
          }}
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={active.placeholder}
          rows={4}
          className="w-full font-numbers outline-none mt-2 resize-vertical"
          style={{
            fontSize: 15,
            lineHeight: '19px',
            padding: '8px 10px',
            color: 'var(--alice-text)',
            backgroundColor: 'var(--alice-bg-soft)',
            border: '1px solid var(--alice-border)',
            borderRadius: 2,
          }}
        />

        <div
          className="mt-3"
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={handleDrop}
          style={{
            padding: 10,
            backgroundColor: 'var(--alice-bg-soft)',
            border: `2px dashed ${dragActive ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
            borderRadius: 2,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p
                className="font-numbers m-0"
                style={{ fontSize: 14, lineHeight: '17px', color: 'var(--alice-text)' }}
              >
                Optional screenshot
              </p>
              <p
                className="font-numbers m-0 mt-1"
                style={{ fontSize: 13, lineHeight: '15px', opacity: 0.65 }}
              >
                Drop an image here, or attach it manually when sending by email or GitHub.
              </p>
            </div>
            <label
              className="font-pixel tracking-widest cursor-pointer"
              style={{
                fontSize: 10,
                padding: '9px 10px',
                border: '2px solid var(--alice-primary)',
                borderRadius: 2,
                color: 'var(--alice-primary)',
                whiteSpace: 'nowrap',
              }}
            >
              ADD IMAGE
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleScreenshotChange(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {screenshotPreview && (
            <div className="mt-3">
              <img
                src={screenshotPreview}
                alt="Selected screenshot preview"
                style={{
                  width: '100%',
                  maxHeight: 180,
                  objectFit: 'contain',
                  border: '1px solid var(--alice-border)',
                  borderRadius: 2,
                  backgroundColor: 'var(--alice-bg)',
                }}
              />
              <div className="flex items-center justify-between gap-2 mt-2">
                <p
                  className="font-numbers m-0"
                  style={{ fontSize: 13, lineHeight: '15px', opacity: 0.7, overflowWrap: 'anywhere' }}
                >
                  {screenshot?.name}
                </p>
                <button
                  type="button"
                  onClick={() => handleScreenshotChange(null)}
                  className="font-pixel tracking-widest cursor-pointer"
                  style={{
                    fontSize: 10,
                    padding: '7px 8px',
                    border: '1px solid var(--alice-border)',
                    borderRadius: 2,
                    backgroundColor: 'transparent',
                    color: 'var(--alice-primary)',
                  }}
                >
                  REMOVE
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-2 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <button
            onClick={onClose}
            className="font-pixel tracking-widest flex-1 cursor-pointer"
            style={{
              fontSize: 10,
              padding: '10px 12px',
              border: '2px solid var(--alice-border)',
              borderRadius: 2,
              backgroundColor: 'transparent',
              color: 'var(--alice-primary)',
            }}
          >
            CANCEL
          </button>
          <button
            onClick={() => void handleCopy()}
            disabled={!trimmedDescription}
            className="font-pixel tracking-widest flex-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              fontSize: 10,
              padding: '10px 12px',
              border: '2px solid var(--alice-primary)',
              borderRadius: 2,
              backgroundColor: 'transparent',
              color: 'var(--alice-primary)',
            }}
          >
            {copied ? 'COPIED' : 'COPY REPORT'}
          </button>
          <button
            onClick={() => void handleEmail()}
            disabled={!trimmedDescription}
            className="font-pixel tracking-widest flex-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              fontSize: 10,
              padding: '10px 12px',
              border: '2px solid var(--alice-primary)',
              borderRadius: 2,
              backgroundColor: 'transparent',
              color: 'var(--alice-primary)',
            }}
          >
            EMAIL REPORT
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!trimmedDescription}
            className="font-pixel tracking-widest flex-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              fontSize: 10,
              padding: '10px 12px',
              border: '2px solid var(--alice-primary)',
              borderRadius: 2,
              backgroundColor: 'var(--alice-primary)',
              color: 'var(--alice-on-primary)',
            }}
          >
            GITHUB
          </button>
        </div>
      </div>
    </div>
  );
}
