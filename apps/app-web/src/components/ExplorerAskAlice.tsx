'use client';

// The "Ask Alice" sidebar: the wallet chat, docked inside Explorer, plus
// the three contracts on top. Every message composed here goes through
// composeAskAlice: the active page's de-identified AbstractSignals ride along
// as an explicit block INSIDE the user message, so what the bubble shows IS
// what the model received. Conversations run through the shared ChatProvider,
// so they stream, persist, and appear in the left sidebar's history exactly
// like main-chat conversations.
//
// Guarantees enforced here, by code not prose:
//  - the send path recomposes through route() and refuses any backend not in
//    decision.allowedBackends, so the UI cannot bypass the routing contract.
//  - class D (any identifying data) is only ever sent to a local model; an
//    off-device backend just cannot send it, and nothing switches silently.
//  - the Private Cloud backend requires an explicit OK on a disclaimer, shown
//    on every opening until the user ticks "don't show this again".
//  - a seed/private key blocks the turn outright.
// Explorer stays fully usable with Alice off; this sidebar just explains that.

import { useEffect, useMemo, useRef, useState } from 'react';
import { detectSensitiveInput, useChat } from '@alice-wallet/alice-ai';
import { AliceIcon } from '@/components/AliceIcon';
import { AskAliceIcon } from '@/components/AskAliceIcon';
import { ChatMessage } from '@/components/ChatMessage';
import { ModelSelector } from '@/components/ModelSelector';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { composeAskAlice, type FullContext } from '@/lib/explorer/ask-alice';
import { renderAbstractSignal, toAbstractSignal } from '@/lib/explorer/audit-core';
import type { PrivacySignal } from '@/lib/explorer/signals';

const ERROR_COLOR = '#e06060';

const DEFAULT_QUESTIONS = [
  'How exposed am I here?',
  'What could someone learn from this?',
  'How do I avoid this next time?',
];

// Users can prefill their own questions (Settings will write this key); read
// defensively so a malformed value just falls back to the defaults.
const QUESTIONS_KEY = 'alice.ask-alice.questions';

// Ticking "don't show this again" on the cloud disclaimer persists here; the
// disclaimer otherwise returns on every opening of the sidebar.
const CLOUD_DISCLAIMER_KEY = 'alice.explorer.cloud-disclaimer-ok';

// Same mechanism for the identified-mode dialog: researchers who enable it all
// day can silence the dialog; the MODE itself still never persists.
const IDENTIFIED_DISCLAIMER_KEY = 'alice.explorer.identified-disclaimer-ok';

function identifiedDisclaimerDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(IDENTIFIED_DISCLAIMER_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadUserQuestions(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUESTIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
  } catch {
    return [];
  }
}

function cloudDisclaimerDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CLOUD_DISCLAIMER_KEY) === 'true';
  } catch {
    return false;
  }
}

function forbid(text: string): boolean {
  return detectSensitiveInput(text) !== null;
}

// Eye glyphs for the identified-mode toggle, hand-rolled like the app's other
// SVG icons (see BrainIcon): open eye = identified, closed eye = de-identified.
function EyeOpenIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function EyeClosedIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 11s3.5 5 10 5 10-5 10-5" />
      <path d="M4.5 14.8 3 17.2" />
      <path d="M12 16.2v2.8" />
      <path d="M19.5 14.8 21 17.2" />
    </svg>
  );
}

// Chain-link glyph, mail-attachment style: hand-rolled like the app's other
// SVG icons (see BrainIcon).
function LinkIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" />
    </svg>
  );
}

// The page analysis as ONE compact attachment chip, sitting next to the send
// button. Its label is the page's short identifier (last characters of the
// txid or address, or the block height): a purely local name so a human
// recognises what it is about; it is NEVER part of what is sent. Clicking it
// opens the exact list of what does cross to the model.
function AttachmentChip({
  contextLabel,
  full,
  expanded,
  onToggle,
  onRemove,
}: {
  contextLabel: string;
  /** Identified mode: the full page details ride along, not just signals. */
  full: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 min-w-0"
      style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg-soft)', padding: '5px 8px' }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title="Show the exact text sent to the model"
        className="flex items-center gap-1.5 cursor-pointer bg-transparent border-none p-0 min-w-0"
      >
        <span className="shrink-0 flex items-center" style={{ color: 'var(--alice-muted)' }}>
          <LinkIcon />
        </span>
        <span className="font-numbers block truncate" style={{ fontSize: 12, color: 'var(--alice-text)' }}>
          {contextLabel}
        </span>
        {full && (
          <span className="font-pixel tracking-widest shrink-0" style={{ fontSize: 6, padding: '2px 4px', border: '1px solid var(--alice-primary)', borderRadius: 2, color: 'var(--alice-primary)' }}>
            FULL
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove this attachment"
        className="shrink-0 cursor-pointer bg-transparent border-none p-0"
        style={{ color: 'var(--alice-muted)', fontSize: 13, lineHeight: '13px' }}
      >
        ×
      </button>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <AliceIcon size={22} color="var(--alice-text)" />
      {[0, 0.2, 0.4].map(delay => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ backgroundColor: 'var(--alice-muted)', animationDelay: `${delay}s`, animationDuration: '1.4s' }}
        />
      ))}
    </div>
  );
}

export function ExplorerAskAlice({
  signals,
  fullContext,
  contextId,
  contextLabel,
  onActivity,
  onClose,
}: {
  /** The active page's signals, all attached by default (removable here). */
  signals: PrivacySignal[];
  /** The page's identified-mode description, when the page provides one. */
  fullContext: FullContext | null;
  /** Identity of the page the signals come from (the active tab id): when it
      changes, the proposed attachments follow the page the user is now on. */
  contextId: string;
  /** Plain-words name of the page kind, for the attachment title:
      "this transaction", "this address", "this block", "this page". */
  contextLabel: string;
  /** Called on every send, so the workspace can link the conversation to the
      tabs currently open (history can then restore the exploration). */
  onActivity?: () => void;
  onClose: () => void;
}) {
  const {
    messages,
    input,
    setInput,
    send,
    busy,
    aiEnabled,
    backendType,
    setBackendType,
    setAiEnabled,
    localAvailable,
  } = useChat();

  // Only signals with a declared projection can be attached (fail-closed: a
  // rule without a projection simply cannot cross, same as toAbstractSignals).
  // Aligned index-for-index with composition.abstractSignals, so removing chip
  // i removes selected[i].
  const [selected, setSelected] = useState<PrivacySignal[]>(() => signals.filter(s => toAbstractSignal(s) !== null));
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [approved, setApproved] = useState<boolean>(() => cloudDisclaimerDismissed());
  const [disclaimer, setDisclaimer] = useState<{ pending: string } | null>(null);
  // Identified mode is per-opening and off by default: enabling it always goes
  // through its own explicit dialog, never a sticky preference.
  const [fullMode, setFullMode] = useState(false);
  const [identifiedPrompt, setIdentifiedPrompt] = useState(false);
  const [dontShowIdentified, setDontShowIdentified] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const scrollRef = useAutoScroll([messages, busy]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const disclaimerOpen = useRef(false);
  disclaimerOpen.current = disclaimer !== null;

  // Grow the borderless composer with its content, like the chat's input.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = '26px';
    el.style.height = Math.min(Math.max(el.scrollHeight, 26), 96) + 'px';
  }, [input]);

  const questionChips = useMemo(
    () => Array.from(new Set([...loadUserQuestions(), ...DEFAULT_QUESTIONS])).slice(0, 5),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (disclaimerOpen.current) setDisclaimer(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The sidebar is persistent: when the user navigates to another page (or the
  // active page's analysis lands), the proposed attachments follow. Chips the
  // user removed stay removed until the page or its analysis changes.
  useEffect(() => {
    setSelected(signals.filter(s => toAbstractSignal(s) !== null));
    setPayloadOpen(false);
  }, [contextId, signals]);

  // The composition the NEXT message would carry. route() is the authority:
  // class and allowed backends come from here, never from the UI.
  const composition = useMemo(
    () => composeAskAlice({
      signals: selected,
      question: input,
      prefs: { cloudConsent: true, identifiedConsent: fullMode },
      fullContext: fullMode && fullContext ? fullContext : undefined,
    }, { detectForbidden: forbid }),
    [selected, input, fullMode, fullContext],
  );
  const decision = composition.decision;

  // The chat's backend is shared with the main chat. 'custom' is the user's
  // own off-device server: for routing it counts as off-device exactly like
  // the attested cloud (class D can never reach it), but the Private Cloud
  // disclaimer is not shown for it since the user configured that endpoint.
  const offDevice = backendType !== 'local';
  const routeBackend = offDevice ? 'cloud_attested' : 'local';
  const backendAllowed = !decision.blocked && decision.allowedBackends.includes(routeBackend);

  async function doSend(q: string, consent: boolean) {
    // Recompose with the question actually sent; refuse any backend route()
    // does not allow. The reason line below the composer explains why.
    const comp = composeAskAlice(
      {
        signals: selected,
        question: q,
        prefs: { cloudConsent: consent || backendType === 'custom', identifiedConsent: fullMode },
        fullContext: fullMode && fullContext ? fullContext : undefined,
      },
      { detectForbidden: forbid },
    );
    if (comp.decision.blocked || !comp.decision.allowedBackends.includes(routeBackend)) return;
    setInput('');
    onActivity?.();
    await send(comp.userMessage);
  }

  function requestSend(raw?: string) {
    const q = (raw ?? input).trim();
    if (!q || busy || !aiEnabled || decision.blocked) return;
    if (raw !== undefined) setInput(raw);
    if (backendType === 'cloud' && !approved) {
      setDisclaimer({ pending: q });
      return;
    }
    void doSend(q, approved);
  }

  function confirmDisclaimer() {
    setApproved(true);
    if (dontShowAgain) {
      try { window.localStorage.setItem(CLOUD_DISCLAIMER_KEY, 'true'); } catch { /* best effort */ }
    }
    const pending = disclaimer?.pending;
    setDisclaimer(null);
    if (pending) void doSend(pending, true);
  }

  // One structural reason at a time, only when the composer truly cannot send.
  const reason = !aiEnabled
    ? 'Alice is turned off. Turn it on in Settings to ask.'
    : decision.blocked
      ? null
      : !backendAllowed
        ? localAvailable
          ? 'This includes identifying data, so it can only be sent to a local model. Switch the model to local to ask.'
          : 'This includes identifying data, so it can only be sent to a local model, and none is available here. It is never sent off this device.'
        : null;

  const latestUserIndex = messages.reduce((latest, m, i) => (m.role === 'user' ? i : latest), -1);
  const replyStarted = latestUserIndex >= 0 && messages
    .slice(latestUserIndex + 1)
    .some(m => m.role === 'assistant' && m.content.trim().length > 0);

  return (
    <div
      className="relative flex flex-col h-full w-full min-h-0"
      aria-label="Ask Alice"
      style={{ backgroundColor: 'var(--alice-bg-soft)' }}
    >
      {/* Slim header, wallet-mobile style: the model selector and the close
          control, nothing else. */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        <ModelSelector
          backendType={backendType}
          setBackendType={setBackendType}
          setAiEnabled={setAiEnabled}
          compactLabel
          placement="below"
        />
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer bg-transparent border-none"
          style={{ color: 'var(--alice-muted)', fontSize: 18, lineHeight: '18px' }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Conversation; empty, it becomes the invitation: Ask Alice, and some
          ideas to start from. They vanish once the conversation exists. */}
      <div
        ref={scrollRef}
        className={messages.length === 0
          ? 'flex flex-col items-center justify-center gap-4 px-6 flex-1 overflow-y-auto'
          : 'flex flex-col gap-1 px-4 py-3 flex-1 overflow-y-auto overflow-x-hidden'}
        style={{ overflowWrap: 'anywhere' }}
      >
        {messages.length === 0 ? (
          <>
            <AskAliceIcon size={44} />
            <span className="font-pixel tracking-widest" style={{ fontSize: 9, color: 'var(--alice-primary)' }}>
              ASK ALICE
            </span>
            <div className="flex flex-col items-stretch gap-2 w-full" style={{ maxWidth: 300 }}>
              {questionChips.map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => requestSend(q)}
                  disabled={busy}
                  className="font-numbers cursor-pointer disabled:cursor-not-allowed"
                  style={{ fontSize: 13, padding: '8px 12px', border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'transparent', color: 'var(--alice-primary)' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {messages.map(m => <ChatMessage key={m.id} message={m} compact />)}
            {busy && !replyStarted && <TypingIndicator />}
          </>
        )}
      </div>

      {/* Composer: attachments, prefilled questions, input, reason. */}
      <div className="flex flex-col gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--alice-border)' }}>
        {decision.blocked && (
          <div className="flex flex-col gap-1 px-3 py-2" style={{ border: `1px solid ${ERROR_COLOR}`, borderRadius: 2 }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 6, color: ERROR_COLOR }}>NOTHING SENT</span>
            <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-text)' }}>{decision.reason}</p>
          </div>
        )}

        {/* The exact payload, opened from the attachment chip below. */}
        {payloadOpen && composition.abstractSignals.length > 0 && (
          <div className="flex flex-col gap-2 px-3 py-2" style={{ border: '1px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'var(--alice-bg)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 6, color: 'var(--alice-muted)' }}>
              SENT TO ALICE, EXACTLY:
            </span>
            {fullMode && fullContext && (
              <p className="font-numbers m-0 whitespace-pre-wrap" style={{ fontSize: 11, lineHeight: '16px', color: 'var(--alice-text)' }}>
                {fullContext.description}
              </p>
            )}
            {!(fullMode && fullContext) && composition.abstractSignals.map((s, i) => (
              <p key={i} className="font-numbers m-0" style={{ fontSize: 11, lineHeight: '16px', color: 'var(--alice-text)' }}>
                · {renderAbstractSignal(s)}
              </p>
            ))}
            <p className="font-numbers m-0" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
              {fullMode && fullContext
                ? 'Identified mode: everything above, identifiers included, rides along with your question.'
                : 'The name of this attachment stays on your device; the txid, address and block are never sent.'}
            </p>
          </div>
        )}

        {/* Borderless composer: the section's top border is separation enough.
            The attachment chip shares the bottom row with the send button. */}
        <textarea
          ref={composerRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              requestSend();
            }
          }}
          placeholder="Ask Alice something..."
          maxLength={500}
          rows={1}
          className="w-full min-w-0 resize-none bg-transparent border-none outline-none font-numbers placeholder:opacity-50"
          style={{ fontSize: 16, lineHeight: '26px', height: 26, minHeight: 26, maxHeight: 96, color: 'var(--alice-text)', overflowY: input.includes('\n') ? 'auto' : 'hidden' }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center min-w-0">
            {composition.abstractSignals.length > 0 && (
              <AttachmentChip
                contextLabel={contextLabel}
                full={fullMode && !!fullContext}
                expanded={payloadOpen}
                onToggle={() => setPayloadOpen(o => !o)}
                onRemove={() => {
                  setSelected([]);
                  setPayloadOpen(false);
                }}
              />
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
          {fullContext && (
            <button
              type="button"
              onClick={() => {
                if (fullMode) setFullMode(false);
                else if (identifiedDisclaimerDismissed()) setFullMode(true);
                else setIdentifiedPrompt(true);
              }}
              aria-pressed={fullMode}
              aria-label="Identified mode"
              title={fullMode
                ? 'Identified mode on: the page\'s full details, identifiers included, ride along. Click to go back to de-identified.'
                : 'De-identified mode: only abstract signals ride along. Click to send the full page details instead.'}
              className="w-9 h-9 flex items-center justify-center shrink-0 cursor-pointer"
              style={{
                border: 'none',
                borderRadius: 2,
                backgroundColor: fullMode ? 'var(--alice-primary)' : 'transparent',
                color: fullMode ? 'var(--alice-on-primary)' : 'var(--alice-muted)',
              }}
            >
              {fullMode ? <EyeOpenIcon /> : <EyeClosedIcon />}
            </button>
          )}
          <button
            type="button"
            onClick={() => requestSend()}
            disabled={!input.trim() || busy || !aiEnabled || decision.blocked || !backendAllowed}
            className="w-9 h-9 flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{ backgroundColor: 'var(--alice-text)', borderRadius: 2 }}
            aria-label="Send"
          >
            <span className="font-pixel leading-none" style={{ color: 'var(--alice-bg)', fontSize: 18, transform: 'translateY(1px)' }}>
              ↑
            </span>
          </button>
          </div>
        </div>
        {reason && (
          <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{reason}</p>
        )}
      </div>

      {/* Identified mode: its own explicit gate, every time it is turned on.
          Never persisted: the default is always de-identified. */}
      {identifiedPrompt && (
        <div className="absolute inset-0 flex items-center justify-center px-6" style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)', zIndex: 10 }}>
          <div className="flex flex-col gap-3 px-4 py-4 w-full" style={{ backgroundColor: 'var(--alice-bg-soft)', border: '2px solid var(--alice-border)', borderRadius: 2 }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 8, color: 'var(--alice-primary)' }}>IDENTIFIED MODE</span>
            <p className="font-numbers m-0" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--alice-text)' }}>
              The full details of this page (txid, addresses, amounts) will ride
              along with your questions, so Alice can follow the actual coins.
              Meant for auditing third parties. If these coins are yours, stay
              de-identified: in this mode the identifiers reach the model, and a
              cloud model also learns you are interested in them.
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={dontShowIdentified} onChange={e => setDontShowIdentified(e.target.checked)} />
              <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>Don&apos;t show this again</span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIdentifiedPrompt(false)}
                className="font-pixel tracking-widest cursor-pointer"
                style={{ fontSize: 7, padding: '9px 14px', border: '2px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'transparent', color: 'var(--alice-muted)' }}
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => {
                  if (dontShowIdentified) {
                    try { window.localStorage.setItem(IDENTIFIED_DISCLAIMER_KEY, 'true'); } catch { /* best effort */ }
                  }
                  setFullMode(true);
                  setIdentifiedPrompt(false);
                }}
                className="font-pixel tracking-widest cursor-pointer"
                style={{ fontSize: 7, padding: '9px 14px', border: '2px solid var(--alice-primary)', borderRadius: 2, backgroundColor: 'var(--alice-primary)', color: 'var(--alice-on-primary)' }}
              >
                TURN ON
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Private Cloud disclaimer: an explicit OK gates the first cloud send
          of every opening, until "don't show this again" is ticked. */}
      {disclaimer && (
        <div className="absolute inset-0 flex items-center justify-center px-6" style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)', zIndex: 10 }}>
          <div className="flex flex-col gap-3 px-4 py-4 w-full" style={{ backgroundColor: 'var(--alice-bg-soft)', border: '2px solid var(--alice-border)', borderRadius: 2 }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 8, color: 'var(--alice-primary)' }}>PRIVATE CLOUD</span>
            <p className="font-numbers m-0" style={{ fontSize: 13, lineHeight: '19px', color: 'var(--alice-text)' }}>
              Your question and the de-identified signals will be processed on Alice&apos;s Private
              Cloud. It never receives addresses, transaction ids or wallet data, but it is less
              private than a model running on your device. If you are asking about your own
              transactions, prefer a local model when you can.
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={dontShowAgain} onChange={e => setDontShowAgain(e.target.checked)} />
              <span className="font-numbers" style={{ fontSize: 12, color: 'var(--alice-muted)' }}>Don&apos;t show this again</span>
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDisclaimer(null)}
                className="font-pixel tracking-widest cursor-pointer"
                style={{ fontSize: 7, padding: '9px 14px', border: '2px solid var(--alice-border)', borderRadius: 2, backgroundColor: 'transparent', color: 'var(--alice-muted)' }}
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={confirmDisclaimer}
                className="font-pixel tracking-widest cursor-pointer"
                style={{ fontSize: 7, padding: '9px 14px', border: '2px solid var(--alice-primary)', borderRadius: 2, backgroundColor: 'var(--alice-primary)', color: 'var(--alice-on-primary)' }}
              >
                OK, ASK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
