'use client';

import { SvgIcon } from '@/components/SvgIcon';
import { CLOSE_ICON, COPY_ICON, CHECK_ICON, MAIL_ICON, EXTERNAL_ICON, ATTACHMENT_ICON, DELETE_ICON } from '@/lib/atelier-icons';

import { type DragEvent, useEffect, useRef, useState } from 'react';
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
  const screenshotInput = useRef<HTMLInputElement>(null);
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
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
          id="feedback-title"
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

        <div role="group" aria-label="Report category" className="flex flex-wrap gap-1.5 mt-4">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              aria-pressed={category === c.id}
              className="alice-control alice-control--choice flex-1"
              style={{ lineHeight: '20px', padding: '8px 6px' }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <label className="alice-field-label mt-4" htmlFor="feedback-summary">Summary</label>
        <input
          id="feedback-summary"
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short summary"
          maxLength={120}
          className="alice-field w-full"
          style={{
            minHeight: 40,
            fontSize: 15,
            padding: '0 10px',
            color: 'var(--alice-text)',
            backgroundColor: 'transparent',
            border: '1px solid var(--alice-border)',
            borderRadius: 2,
          }}
        />

        <label className="alice-field-label mt-3" htmlFor="feedback-description">Description <span style={{ color: 'var(--alice-muted)' }}>(required)</span></label>
        <textarea
          id="feedback-description"
          required
          aria-describedby="feedback-send-help"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={active.placeholder}
          rows={4}
          className="alice-field w-full resize-y"
          style={{
            fontSize: 15,
            lineHeight: '19px',
            padding: '8px 10px',
            color: 'var(--alice-text)',
            backgroundColor: 'transparent',
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
            backgroundColor: 'transparent',
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
                Choose or drop an image to preview it. Attach it manually in your email or GitHub issue; it is not uploaded here.
              </p>
            </div>
            <button type="button" className="alice-control alice-control--quiet" onClick={() => screenshotInput.current?.click()}>
              <SvgIcon svg={ATTACHMENT_ICON} size={20} /> Choose image
            </button>
            <input ref={screenshotInput} type="file" accept="image/*" className="hidden" aria-label="Choose screenshot" onChange={(event) => handleScreenshotChange(event.target.files?.[0] ?? null)} />
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
                  className="alice-control alice-control--quiet"
                  style={{ padding: '7px 8px' }}
                >
                  <SvgIcon svg={DELETE_ICON} size={16} /> Remove
                </button>
              </div>
            </div>
          )}
        </div>

        <p id="feedback-send-help" className="font-numbers mt-3" style={{ fontSize: 13, color: 'var(--alice-muted)' }}>Add a description to prepare a report. Email opens a draft; GitHub opens a new issue form for you to review and submit.</p>
        <div className="grid gap-2 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <button
            onClick={onClose}
            className="alice-control alice-control--quiet flex-1"
            style={{ padding: '10px 12px' }}
          >
            <SvgIcon svg={CLOSE_ICON} size={16} /> Cancel
          </button>
          <button
            onClick={() => void handleCopy()}
            disabled={!trimmedDescription}
            className="alice-control alice-control--quiet flex-1 disabled:cursor-not-allowed"
            style={{ padding: '10px 12px' }}
          >
            <SvgIcon svg={copied ? CHECK_ICON : COPY_ICON} size={16} /> <span aria-live="polite">{copied ? 'Copied' : 'Copy report'}</span>
          </button>
          <button
            onClick={() => void handleEmail()}
            disabled={!trimmedDescription}
            className="alice-control alice-control--quiet flex-1 disabled:cursor-not-allowed"
            style={{ padding: '10px 12px' }}
          >
            <SvgIcon svg={MAIL_ICON} size={20} /> Prepare email
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!trimmedDescription}
            className="alice-control alice-control--primary flex-1 disabled:cursor-not-allowed"
            style={{ padding: '10px 12px' }}
          >
            <SvgIcon svg={EXTERNAL_ICON} size={16} /> Continue on GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
