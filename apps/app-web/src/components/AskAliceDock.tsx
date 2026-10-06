'use client';

// The "Ask Alice" dock: the wallet chat, docked inside Explorer, Learn and
// the Playground, plus the three contracts on top. Every message composed
// here goes through
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
// Every section stays fully usable with Alice off; this dock just explains that.

import { useEffect, useMemo, useRef, useState } from 'react';
import { detectSensitiveInput, useChat } from '@alice-wallet/alice-ai';
import { ModelSelector } from '@/components/ModelSelector';
import { SideChatConversation } from '@/components/SideChatConversation';
import { SendMessageButton } from '@/components/SendMessageButton';
import { SvgIcon } from '@/components/SvgIcon';
import { PLUS_ICON, CLOSE_ICON, ATTACHMENT_ICON, EYE_OPEN_ICON, EYE_CLOSED_ICON } from '@/lib/atelier-icons';
import { composeAskAlice, type FullContext } from '@/lib/explorer/ask-alice';
import { renderAbstractSignal, toAbstractSignal } from '@/lib/explorer/audit-core';
import type { PrivacySignal } from '@/lib/explorer/signals';

const ERROR_COLOR = 'var(--alice-danger)';

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

// Pixel eye glyphs preserve the identified/de-identified distinction.
function EyeOpenIcon() { return <SvgIcon svg={EYE_OPEN_ICON} size={16} />; }

function EyeClosedIcon() { return <SvgIcon svg={EYE_CLOSED_ICON} size={16} />; }

// Attachment glyph shared with the Learn composer.
function LinkIcon() { return <SvgIcon svg={ATTACHMENT_ICON} size={16} />; }

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
      className="alice-attachment"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        title="Show the exact text sent to the model"
        className="alice-control alice-control--quiet alice-attachment-label"
      >
        <span className="shrink-0 flex items-center" style={{ color: 'var(--alice-muted)' }}>
          <LinkIcon />
        </span>
        <span className="font-numbers block truncate" style={{ fontSize: 12, color: 'var(--alice-text)' }}>
          {contextLabel}
        </span>
        {full && (
          <span className="font-pixel tracking-widest shrink-0" style={{ fontSize: 10, padding: '2px 4px', border: '1px solid var(--alice-primary)', borderRadius: 'var(--alice-radius-control)', color: 'var(--alice-primary)' }}>
            FULL
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove this attachment"
        className="alice-control alice-control--tool"
      >
        <SvgIcon svg={CLOSE_ICON} size={16} />
      </button>
    </div>
  );
}

export function AskAliceDock({
  signals,
  fullContext,
  contextId,
  contextLabel,
  defaultQuestions,
  pageNote,
  onActivity,
  onClose,
}: {
  /** Surface-specific suggested questions; the Explorer's privacy set otherwise. */
  defaultQuestions?: readonly string[];
  /** Identity-free page sentence for the de-identified block (see composeAskAlice). */
  pageNote?: string;
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
    input,
    setInput,
    send,
    busy,
    aiEnabled,
    backendType,
    setBackendType,
    setAiEnabled,
    localAvailable,
    clearMessages,
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
    () => Array.from(new Set([...loadUserQuestions(), ...(defaultQuestions ?? DEFAULT_QUESTIONS)])).slice(0, 5),
    [defaultQuestions],
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
      pageNote,
    }, { detectForbidden: forbid }),
    [selected, input, fullMode, fullContext, pageNote],
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
        pageNote,
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

  return (
    <div
      className="alice-ask-panel relative flex flex-col h-full w-full min-h-0"
      aria-label="Ask Alice"
      style={{ backgroundColor: 'var(--alice-bg-soft)' }}
    >
      {/* Conversation actions stay at the top; model choices live by the input. */}
      <div className="flex items-center justify-end px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => clearMessages()}
            className="alice-control alice-control--tool"
            aria-label="New conversation"
            title="New conversation"
          >
            <SvgIcon svg={PLUS_ICON} size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="alice-control alice-control--tool"
            aria-label="Close"
          >
            <SvgIcon svg={CLOSE_ICON} size={16} />
          </button>
        </div>
      </div>

      <SideChatConversation input={input} questions={questionChips} onQuestion={requestSend} disabled={decision.blocked || !backendAllowed} />

      {/* Composer: attachments, prefilled questions, input, reason. */}
      <div className="alice-panel-composer flex flex-col gap-2 shrink-0">
        {decision.blocked && (
          <div className="flex flex-col gap-1 px-3 py-2" style={{ border: `1px solid ${ERROR_COLOR}`, borderRadius: 'var(--alice-radius-control)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: ERROR_COLOR }}>NOTHING SENT</span>
            <p className="font-numbers m-0" style={{ fontSize: 12, color: 'var(--alice-text)' }}>{decision.reason}</p>
          </div>
        )}

        {/* The exact payload, opened from the attachment chip below. */}
        {payloadOpen && composition.abstractSignals.length > 0 && (
          <div className="flex flex-col gap-2 px-3 py-2" style={{ border: '1px solid var(--alice-border)', borderRadius: 'var(--alice-radius-control)', backgroundColor: 'var(--alice-bg)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-muted)' }}>
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

        {/* The framed composer keeps context review above model and send controls. */}
        <textarea
          aria-label="Message Alice"
          ref={composerRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
              className="alice-control alice-control--tool alice-context-toggle"
            >
              {fullMode ? <EyeOpenIcon /> : <EyeClosedIcon />}
            </button>
          )}
          </div>
        </div>
        <div className="alice-panel-controls">
          <ModelSelector
            backendType={backendType}
            setBackendType={setBackendType}
            setAiEnabled={setAiEnabled}
            placement="composer"
          />
          <SendMessageButton onClick={() => requestSend()} disabled={!input.trim() || busy || !aiEnabled || decision.blocked || !backendAllowed} />
        </div>
        {reason && (
          <p className="font-numbers m-0" style={{ fontSize: 11, color: 'var(--alice-muted)' }}>{reason}</p>
        )}
      </div>

      {/* Identified mode: its own explicit gate, every time it is turned on.
          Never persisted: the default is always de-identified. */}
      {identifiedPrompt && (
        <div className="absolute inset-0 flex items-center justify-center px-6" style={{ backgroundColor: 'rgba(0, 0, 0, 0.55)', zIndex: 10 }}>
          <div className="flex flex-col gap-3 px-4 py-4 w-full" style={{ backgroundColor: 'var(--alice-bg)', border: '1px solid var(--alice-border)', borderRadius: 'var(--alice-radius-control)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-primary)' }}>IDENTIFIED MODE</span>
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
                className="alice-control alice-control--quiet"
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
                className="alice-control alice-control--primary"
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
          <div className="flex flex-col gap-3 px-4 py-4 w-full" style={{ backgroundColor: 'var(--alice-bg)', border: '1px solid var(--alice-border)', borderRadius: 'var(--alice-radius-control)' }}>
            <span className="font-pixel tracking-widest" style={{ fontSize: 10, color: 'var(--alice-primary)' }}>PRIVATE CLOUD</span>
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
                className="alice-control alice-control--quiet"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={confirmDisclaimer}
                className="alice-control alice-control--primary"
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
