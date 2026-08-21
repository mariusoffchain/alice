import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AIBackend, AIBackendType, AIBackendStatus, TokenUsage } from './ai-backend';
import { VeniceAPIError, type Message } from './llm';
import { quotaBlockOf } from './venice-errors';
import { createBackend, canUseLocal, isTauriDesktop } from './ai-backend-factory';
import { generateLanguageChecked, WrongResponseLanguageError } from './language-generation';
import { buildRagTurnContext, isTechnicalRagQuery } from './rag';
import { ragContextChunkLimit } from './rag-context-budget';
import { isDefinitionQuestion, pedagogicalContext, recordPedagogicalSignal } from './pedagogical-profile';
import {
  ALICE_MEMORY_CAPTURE_INSTRUCTION,
  aliceMemoryContext,
  getAliceMemory,
  rememberAliceCandidates,
} from './alice-memory';
import { prepareAliceTurn, type TurnPreparationDiagnostics } from './turn-engine';
import {
  getAIBackendEnabledState,
  getAliceInstructions,
  getResponseLanguagePreference,
  isAIEnabled,
  setAIBackendEnabled,
  setAIEnabled,
  type AIBackendEnabledState,
} from './ai-preferences';
import { resolveResponseLanguage, type SupportedLanguage } from './language-policy';
import { detectSensitiveInput } from './ai-sensitive-input';
import { getAIDisabledMessage } from './ai-availability';
import { applyAliceResponseConstraints, requiresBufferedAliceResponse } from './ai-system-prompt';
import { PRIVATE_CLOUD_ENABLED } from './private-cloud-config';
import { createPrivateCloudRequestId } from './account-client';
import { useAccount } from './account-context';
import {
  cleanupSessions,
  getChatStorageSummary,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  type ChatCleanupMode,
  type ChatCleanupResult,
  type ChatSession,
  type ChatStorageCipher,
  type ChatStorageSummary,
} from './chat-storage';
import {
  GREETING,
  createGreetingMessage,
  isGreeting,
  isPersistableSession,
  stripGreeting,
  toHistory,
} from './greeting';

const BACKEND_KEY = 'alice_ai_backend';

function ragChunkLimit(backendType: AIBackendType, userMessage: string): number {
  if (isDefinitionQuestion(userMessage)) return 1;
  return ragContextChunkLimit(backendType === 'local', isTechnicalRagQuery(userMessage));
}

async function buildGenerationHistory(
  history: Message[],
  userMessage: string,
  backendType: AIBackendType,
  targetLanguage: SupportedLanguage,
  storageCipher?: ChatStorageCipher,
  assistantHistoryDropped = false,
): Promise<{
  history: Message[];
  diagnostics: TurnPreparationDiagnostics;
  directResponse: string | null;
}> {
  const latest = history.at(-1);
  if (!latest || latest.role !== 'user') {
    return {
      history,
      directResponse: null,
      diagnostics: {
        kind: 'conversation',
        requestedCapability: 'text-generation',
        retrieval: 'none',
        retrievedChunkIds: [],
        phaseMs: { plan: 0, pedagogy: 0, retrieval: 0, memory: 0, total: 0 },
      },
    };
  }

  const prepared = await prepareAliceTurn({
    history,
    userMessage,
    backendType,
    targetLanguage,
    assistantHistoryDropped,
  }, {
    recordPedagogicalSignal,
    retrieveKnowledge: query => buildRagTurnContext(query, storageCipher, {
      maxChunks: ragChunkLimit(backendType, query),
      targetLanguage,
    }),
    getMemory: getAliceMemory,
    rememberMemoryCandidates: rememberAliceCandidates,
    pedagogicalContext,
    memoryContext: aliceMemoryContext,
    memoryCaptureInstruction: ALICE_MEMORY_CAPTURE_INSTRUCTION,
  });
  return {
    history: prepared.history,
    diagnostics: prepared.diagnostics,
    directResponse: prepared.directResponse,
  };
}

function currentInterfaceLanguage(): string {
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
}

function userFacingSendError(err: unknown, backendType: AIBackendType): string {
  if (err instanceof WrongResponseLanguageError) return err.message;
  if (err instanceof VeniceAPIError) {
    if (err.code === 'account_required') {
      return 'Private Cloud could not restore its session. Try again.';
    }
    if (err.code === 'free_quota_exhausted') {
      return 'You have used your 21 free Private Cloud requests. Alice Local is still available.';
    }
    if (err.code === 'plan_quota_exhausted') {
      // Says what actually happens next, because on a paid plan the allowance
      // returns on its own and most people should simply wait rather than buy.
      return 'This month\'s Private Cloud allowance is used up. It renews on its own,'
        + ' and Alice Local is still available in the meantime.';
    }
    if (err.code === 'plan_restricted') {
      return 'This Private Cloud model is not included in your current plan.';
    }
    if (err.code === 'missing_api_key') {
      return 'Private Cloud is not configured yet. Add a Venice API key to use cloud answers.';
    }
    if (err.code === 'auth') {
      return 'The Venice API key was rejected. Check that the key is valid and still active, then try again.';
    }
    if (err.code === 'insufficient_credits') {
      return 'Venice credits are exhausted. Add credits to the Venice account, then try again.';
    }
    if (err.code === 'model_unavailable') {
      return 'The selected Venice model is unavailable right now. Try another cloud model or try again later.';
    }
    if (err.code === 'rate_limit') {
      return 'Too many requests to Venice right now. Wait a moment, then try again.';
    }
    if (err.code === 'provider_unavailable') {
      return 'Venice is having trouble on their side. Try again in a few minutes.';
    }
    if (err.code === 'attestation_unavailable') {
      return 'Private Cloud security verification is temporarily unavailable. Try again shortly.';
    }
    if (err.code === 'attestation_invalid') {
      return 'Private Cloud security verification failed. For your privacy, Alice did not send your message.';
    }
    if (err.code === 'network') {
      return 'Network error. Check your connection and try again.';
    }
    return err.status
      ? `Venice API error ${err.status}. Try again later.`
      : 'Venice API error. Try again later.';
  }

  if (backendType === 'cloud' && err instanceof TypeError) {
    return 'Network error. Check your connection and try again.';
  }

  if (backendType === 'cloud') {
    return 'Private Cloud connection error. Try again later.';
  }

  if (backendType === 'local') {
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('context is full') || message.includes('prompt is too long')) {
      return 'Alice Local ran out of context. Start a new conversation or shorten your message. Nothing was sent to the cloud.';
    }
    if (message.includes('model not loaded') || message.includes('no local model installed')) {
      return 'The local model is not ready. Open AI settings and select an installed model. Nothing was sent to the cloud.';
    }
    return 'Alice Local could not generate a response. Nothing was sent to the cloud.';
  }

  return 'Connection error.';
}

export type MessageVariant = {
  content: string;
  time: Date;
  usage?: TokenUsage;
  durationMs?: number;
};

export type ChatMsg = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  time: Date;
  usage?: TokenUsage;
  durationMs?: number;
  // Provider stopped on max_tokens: the answer is cut off, not finished.
  truncated?: boolean;
  variants?: MessageVariant[];
  activeVariant?: number;
  /**
   * This answer never happened because an allowance ran out. Surfaces render
   * an offer here instead of an error line: running out of a quota you bought,
   * or of a free trial, is the product behaving as sold, not a malfunction.
   */
  quotaBlocked?: 'free' | 'plan';
};

type ChatContextValue = {
  messages: ChatMsg[];
  input: string;
  setInput: (s: string) => void;
  send: (text?: string) => Promise<void>;
  busy: boolean;
  backendType: AIBackendType;
  backendStatus: AIBackendStatus;
  setBackendType: (type: AIBackendType) => void;
  localAvailable: boolean;
  aiEnabled: boolean;
  setAiEnabled: (enabled: boolean) => void;
  backendEnabled: AIBackendEnabledState;
  setBackendEnabled: (type: AIBackendType, enabled: boolean) => void;
  clearMessages: () => void;
  showGreeting: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  refreshSessions: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  cleanSessionHistory: (mode: ChatCleanupMode) => Promise<ChatCleanupResult>;
  getSessionStorageSummary: () => Promise<ChatStorageSummary>;
  deleteMessage: (id: string) => void;
  editMessage: (id: string, newContent: string) => Promise<void>;
  setMessageVariant: (id: string, variantIndex: number) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({
  children,
  storageCipher,
}: {
  children: ReactNode;
  storageCipher?: ChatStorageCipher;
}) {
  const account = useAccount();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [backendType, setBackendTypeState] = useState<AIBackendType>(() =>
    // Desktop used to start on 'local'. No model ships with the app, so a fresh
    // install sat on a fifteen-second wait and then an error, while Private
    // Cloud was available and free. Every surface now opens on Private Cloud;
    // a local model is something the user chooses to download afterwards.
    PRIVATE_CLOUD_ENABLED ? 'cloud' : 'custom'
  );
  const [backendReloadKey, setBackendReloadKey] = useState(0);
  const [backendStatus, setBackendStatus] = useState<AIBackendStatus>({ state: 'idle' });
  const [aiEnabled, setAiEnabledState] = useState(true);
  const [backendEnabled, setBackendEnabledState] = useState<AIBackendEnabledState>({
    local: true,
    cloud: true,
    custom: true,
  });
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Bumped to ask for the greeting; 0 means nothing has asked yet.
  const [greetingRequest, setGreetingRequest] = useState(0);
  const historyRef = useRef<Message[]>([]);
  const messagesRef = useRef<ChatMsg[]>([]);
  const backendRef = useRef<AIBackend | null>(null);
  const busyRef = useRef(false);
  const backendSelectedRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionSaveQueueRef = useRef(Promise.resolve());
  const sessionDirtyRef = useRef(false);
  const localAvailable = useMemo(() => canUseLocal(), []);
  const activeBackendEnabled = backendEnabled[backendType];

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Mirrored so the greeting animation can check it without re-running when a
  // generation ends, which would replay the greeting at the wrong moment.
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    Promise.all([
      isAIEnabled(),
      getAIBackendEnabledState(),
      AsyncStorage.getItem(BACKEND_KEY),
    ]).then(([enabled, enabledBackends, stored]) => {
      setAiEnabledState(enabled);
      setBackendEnabledState(enabledBackends);
      if (backendSelectedRef.current) return;

      // A stored choice wins, but only while that backend is still enabled. With
      // no stored choice, desktop prefers the local model (it has one bundled
      // and no network dependency), everything else prefers Private Cloud. The
      // final branch is guarded rather than unconditional so a user who
      // disabled every backend keeps none selected instead of silently landing
      // on a disabled one.
      if (stored === 'local' && localAvailable && enabledBackends.local) setBackendTypeState('local');
      else if (stored === 'custom' && enabledBackends.custom) setBackendTypeState('custom');
      else if (stored === 'cloud' && PRIVATE_CLOUD_ENABLED && enabledBackends.cloud) setBackendTypeState('cloud');
      else if (!stored && isTauriDesktop() && localAvailable && enabledBackends.local) setBackendTypeState('local');
      else if (PRIVATE_CLOUD_ENABLED && enabledBackends.cloud) setBackendTypeState('cloud');
      else if (localAvailable && enabledBackends.local) setBackendTypeState('local');
      else if (enabledBackends.custom) setBackendTypeState('custom');
    }).catch(() => {});
  }, [localAvailable]);

  useEffect(() => {
    if (!activeBackendEnabled) {
      backendRef.current = null;
      setBackendStatus({ state: 'error', message: `${backendType} AI is disabled. Re-enable it in Alice settings.` });
      return;
    }
    const backend = createBackend(backendType);
    let cancelled = false;
    backendRef.current = backend;
    setBackendStatus({ state: 'loading' });
    backend.init()
      .then(() => {
        if (!cancelled && backendRef.current === backend) setBackendStatus(backend.status());
      })
      .catch(err => {
        console.warn(`[chat] ${backendType} backend init failed:`, err);
        if (!cancelled && backendRef.current === backend) setBackendStatus(backend.status());
      });
    return () => {
      cancelled = true;
      if (backendRef.current === backend) backendRef.current = null;
      backend.dispose().catch(() => {});
    };
  }, [backendType, activeBackendEnabled, backendReloadKey]);

  const setBackendType = useCallback((type: AIBackendType) => {
    if (type === 'cloud' && !PRIVATE_CLOUD_ENABLED) return;
    if (type === 'cloud' && !backendEnabled.cloud) return;
    if (type === 'local' && (!localAvailable || !backendEnabled.local)) return;
    if (type === 'custom' && !backendEnabled.custom) return;
    backendSelectedRef.current = true;
    // Invalidate the previous engine synchronously. This prevents a tap in the
    // render between selecting Local and initializing Local from reaching a
    // still-ready Cloud backend (or the reverse).
    backendRef.current = null;
    setBackendStatus({ state: 'loading' });
    setBackendTypeState(type);
    setBackendReloadKey(key => key + 1);
    AsyncStorage.setItem(BACKEND_KEY, type).catch(() => {});
    const label = type === 'local' ? 'local (on-device)' : type === 'custom' ? 'custom server' : 'private cloud';
    setMessages(prev => [...prev, {
      id: `switch-${Date.now()}`,
      role: 'system',
      content: `Switched to ${label} mode.`,
      time: new Date(),
    }]);
  }, [backendEnabled, localAvailable]);

  const setAiEnabled = useCallback((enabled: boolean) => {
    setAiEnabledState(enabled);
    setAIEnabled(enabled).catch(() => {});
  }, []);

  const setBackendEnabled = useCallback((type: AIBackendType, enabled: boolean) => {
    setBackendEnabledState(current => ({ ...current, [type]: enabled }));
    setAIBackendEnabled(type, enabled).catch(() => {});
  }, []);

  const refreshSessions = useCallback(async () => {
    const list = await listSessions(storageCipher);
    setSessions(list);
  }, [storageCipher]);

  const getSessionStorageSummary = useCallback(
    () => getChatStorageSummary(storageCipher),
    [storageCipher],
  );

  useEffect(() => { refreshSessions().catch(() => {}); }, [refreshSessions]);

  const persistSessionMessages = useCallback((
    nextMessages: ChatMsg[],
    sessionId?: string | null,
    updateCurrentSession = true,
  ) => {
    // A conversation with no user message is not a session, and the greeting
    // alone never makes one: it is dropped before the check, not after.
    const persistable = stripGreeting(nextMessages);
    if (!isPersistableSession(nextMessages)) return;
    sessionSaveQueueRef.current = sessionSaveQueueRef.current
      .then(async () => {
        const id = await saveSession(
          persistable,
          sessionId === undefined ? currentSessionIdRef.current : sessionId,
          storageCipher,
        );
        if (id && updateCurrentSession) {
          currentSessionIdRef.current = id;
          setActiveSessionId(id);
        }
        sessionDirtyRef.current = false;
        await refreshSessions();
      })
      .catch(() => {});
  }, [refreshSessions, storageCipher]);

  // Requesting the greeting is a signal, not a state mutation: the animation
  // below owns its own interval through the effect cleanup. The previous
  // version started the interval inside a setMessages updater, which React may
  // invoke more than once, and cleared it through a shared ref, so an older
  // tick could kill a newer timer and freeze the sentence mid-word.
  const showGreeting = useCallback(() => {
    setGreetingRequest(n => n + 1);
  }, []);

  useEffect(() => {
    if (greetingRequest === 0) return;
    // Never animate over a conversation, and never compete with a generation.
    if (busyRef.current) return;
    const currentMessages = messagesRef.current;
    const existingGreeting = currentMessages.find(isGreeting);
    if (currentMessages.some(m => !isGreeting(m))) return;
    if (existingGreeting?.content === GREETING) return;

    const charsPerTick = Platform.OS === 'web' ? 1 : 2;
    // Seed both state and its mirror synchronously. Without this, the first
    // timer tick can observe the previous empty ref, stop itself, and leave the
    // greeting bubble permanently rendered as "...".
    const greeting = {
      ...createGreetingMessage(),
      content: GREETING.slice(0, charsPerTick),
    };
    messagesRef.current = [greeting];
    setMessages([greeting]);

    let i = charsPerTick;
    const timer = setInterval(() => {
      // Only ever write into the greeting bubble. If the user sent something
      // meanwhile the conversation keeps growing around it untouched, and once
      // the bubble is gone there is nothing left to type.
      if (!messagesRef.current.some(isGreeting)) {
        clearInterval(timer);
        return;
      }
      i = Math.min(i + charsPerTick, GREETING.length);
      const slice = GREETING.slice(0, i);
      setMessages(curr => curr.map(m => (
        isGreeting(m) ? { ...m, content: slice } : m
      )));
      if (i >= GREETING.length) clearInterval(timer);
    }, 28);

    return () => clearInterval(timer);
  }, [greetingRequest]);

  const clearMessages = useCallback(() => {
    const sessionId = currentSessionIdRef.current;
    currentSessionIdRef.current = null;
    setActiveSessionId(null);
    setMessages(prev => {
      if (sessionDirtyRef.current) persistSessionMessages(prev, sessionId, false);
      return [];
    });
    historyRef.current = [];
    // A cleared chat shows the greeting again. Done here rather than in an
    // effect watching messages.length, which would also fire during the window
    // where openSession empties the list before the loaded session arrives.
    showGreeting();
  }, [persistSessionMessages, showGreeting]);

  const openSession = useCallback(async (id: string) => {
    const sessionId = currentSessionIdRef.current;
    setMessages(prev => {
      if (sessionDirtyRef.current) persistSessionMessages(prev, sessionId, false);
      return [];
    });
    historyRef.current = [];
    // Sessions written by earlier versions still carry the greeting bubble.
    // Drop it on the way in, so it neither shows up in the restored thread nor
    // reaches the model as a fake first assistant turn.
    const restored = stripGreeting(await loadSession(id, storageCipher));
    currentSessionIdRef.current = restored.length ? id : null;
    setActiveSessionId(restored.length ? id : null);
    if (restored.length) {
      setMessages(restored);
      historyRef.current = toHistory(restored);
    }
  }, [persistSessionMessages, storageCipher]);

  const removeSession = useCallback(async (id: string) => {
    if (currentSessionIdRef.current === id) {
      currentSessionIdRef.current = null;
      setActiveSessionId(null);
    }
    await deleteSession(id, storageCipher);
    await refreshSessions();
  }, [refreshSessions, storageCipher]);

  const cleanSessionHistory = useCallback(async (mode: ChatCleanupMode) => {
    await sessionSaveQueueRef.current.catch(() => {});
    sessionDirtyRef.current = false;
    const result = await cleanupSessions(mode, storageCipher);
    const currentId = currentSessionIdRef.current;
    if (currentId && result.deletedIds.includes(currentId)) {
      currentSessionIdRef.current = null;
      setActiveSessionId(null);
      historyRef.current = [];
      messagesRef.current = [];
      setMessages([]);
      showGreeting();
    }
    await refreshSessions();
    return result;
  }, [refreshSessions, showGreeting, storageCipher]);

  const send = useCallback(async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy || !aiEnabled) return;
    setInput('');

    const disabledMessage = getAIDisabledMessage(aiEnabled, backendType, backendEnabled);
    if (disabledMessage) {
      setMessages(prev => [...prev, {
        id: `disabled-${Date.now()}`,
        role: 'system',
        content: disabledMessage,
        time: new Date(),
      }]);
      return;
    }

    const blocked = detectSensitiveInput(t);
    if (blocked) {
      setMessages(prev => [...prev, {
        id: `blocked-${Date.now()}`,
        role: 'system',
        content: blocked.message,
        time: new Date(),
      }]);
      return;
    }

    const userMsg: ChatMsg = { id: Date.now().toString(), role: 'user', content: t, time: new Date() };
    sessionDirtyRef.current = true;
    setMessages(prev => {
      const next = [...prev, userMsg];
      persistSessionMessages(next);
      return next;
    });
    setBusy(true);

    // Keep the saved conversation raw. RAG is transient request context, not
    // part of the user's message and must not be replayed on later turns.
    historyRef.current.push({ role: 'user', content: t });

    const backend = backendRef.current;
    let pendingAssistantId: string | null = null;
    let usedBackend = false;
    try {
      let full = '';
      const aid = (Date.now() + 1).toString();
      pendingAssistantId = aid;
      setMessages(prev => [...prev, { id: aid, role: 'assistant', content: '', time: new Date() }]);

      const languagePreference = await getResponseLanguagePreference();
      const languageDecision = resolveResponseLanguage({
        message: t,
        preference: languagePreference,
        interfaceLanguage: currentInterfaceLanguage(),
      });
      const generationPreparation = await buildGenerationHistory(
        historyRef.current,
        t,
        backend?.type ?? backendType,
        languageDecision.targetLanguage,
        storageCipher,
        backend?.allowsAutoContinuation === false,
      );
      if (generationPreparation.directResponse) {
        const directResponse = generationPreparation.directResponse;
        setMessages(prev => {
          const next = prev.map(message => (
            message.id === aid ? { ...message, content: directResponse, durationMs: 0 } : message
          ));
          persistSessionMessages(next);
          return next;
        });
        historyRef.current.push({ role: 'assistant', content: directResponse });
        console.info('[alice-turn]', JSON.stringify({
          backend: 'deterministic',
          ...generationPreparation.diagnostics,
          generationMs: 0,
          firstDisplayMs: 0,
          attempts: 0,
          backendTimings: null,
        }));
        return;
      }

      // A backend that is still initializing (a local model loading into
      // memory right after a download, for instance) deserves a bounded wait,
      // not an instant failure: the typing indicator covers the pause.
      let bs = backend?.status();
      if (backend && backend.type === backendType && bs?.state === 'loading') {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && backend.status().state === 'loading') {
          await new Promise<void>(resolve => setTimeout(resolve, 500));
        }
        bs = backend.status();
      }
      if (!backend || backend.type !== backendType || bs?.state !== 'ready') {
        const reason = bs?.state === 'error' ? (bs as any).message : 'AI is still loading. Please wait a moment.';
        setMessages(prev => {
          const next = prev.map(message => (
            message.id === aid ? { ...message, content: reason } : message
          ));
          persistSessionMessages(next);
          return next;
        });
        return;
      }

      const instructions = await getAliceInstructions();
      // Auto-continuation is a cloud-only behaviour. It re-sends the whole
      // conversation each round, a reasonable trade against Venice, but wrong
      // for a local model (slow, battery) or an unknown custom server. Local and
      // Custom still surface the truncation notice through result.truncated; they
      // just never silently continue. A "one sentence" instruction also makes a
      // short answer correct, so it disables continuation even on cloud.
      // A "one sentence" instruction buffers the answer and trims it to a single
      // sentence, so the displayed reply is complete by construction. Provider
      // truncation of the raw output is then irrelevant, and the "may be
      // incomplete" notice would contradict the user's own request, suppress it.
      // (The smallest preset budget is 256 tokens, far more than one sentence, so
      // a genuinely cut-off single sentence is not a realistic case.)
      const buffered = requiresBufferedAliceResponse(instructions);
      // allowsAutoContinuation is false under E2EE: assistant turns are dropped
      // rather than sent in clear, so there is no partial answer to extend.
      const allowContinuation = backend.type === 'cloud'
        && backend.allowsAutoContinuation !== false
        && !buffered;
      usedBackend = true;
      const result = await generateLanguageChecked({
        backend,
        history: generationPreparation.history,
        allowContinuation,
        targetLanguage: languageDecision.targetLanguage,
        requestId: backend.type === 'cloud' ? createPrivateCloudRequestId() : undefined,
        onText: buffered ? undefined : visible => {
          setMessages(prev => prev.map(message => (
            message.id === aid ? { ...message, content: visible } : message
          )));
        },
      });
      const completionTokens = result.usage?.completionTokens ?? null;
      const tokensPerSecond = completionTokens != null && result.durationMs
        ? Math.round((completionTokens * 1000 / result.durationMs) * 10) / 10
        : null;
      console.info('[alice-turn]', JSON.stringify({
        backend: backend.type,
        ...generationPreparation.diagnostics,
        generationMs: result.durationMs ?? null,
        firstDisplayMs: result.firstDisplayMs ?? null,
        completionTokens,
        tokensPerSecond,
        attempts: result.attempts,
        backendTimings: result.backendTimings ?? null,
      }));
      full = applyAliceResponseConstraints(instructions, result.text);
      void rememberAliceCandidates(result.memoryCandidates).catch(() => {});
      setMessages(prev => {
        const next = prev.map(m => m.id === aid ? { ...m, content: full, usage: result.usage, durationMs: result.durationMs, truncated: result.truncated && !buffered } : m);
        persistSessionMessages(next);
        return next;
      });
      historyRef.current.push({ role: 'assistant', content: full });
    } catch (err) {
      console.warn('[chat] send failed:', err);
      setMessages(prev => {
        const content = userFacingSendError(err, backendType);
        const quotaBlocked = quotaBlockOf(err) ?? undefined;
        const next = pendingAssistantId
          ? prev.map(message => message.id === pendingAssistantId ? { ...message, content, quotaBlocked } : message)
          : [...prev, {
            id: (Date.now() + 2).toString(),
            role: 'assistant' as const,
            content,
            time: new Date(),
            quotaBlocked,
          }];
        persistSessionMessages(next);
        return next;
      });
    } finally {
      if (usedBackend && backendType === 'cloud') {
        account.refreshAccount().catch(() => {});
      }
      setBusy(false);
    }
  }, [
    account,
    aiEnabled,
    backendType,
    busy,
    input,
    persistSessionMessages,
    storageCipher,
  ]);

  const deleteMessage = useCallback((id: string) => {
    sessionDirtyRef.current = true;
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx < 0) return prev;
      const msg = prev[idx];
      let next: ChatMsg[];
      if (msg.role === 'user') {
        // Delete user message + its assistant reply (next message if assistant)
        const hasReply = idx + 1 < prev.length && prev[idx + 1].role === 'assistant';
        next = [...prev.slice(0, idx), ...prev.slice(idx + (hasReply ? 2 : 1))];
      } else if (msg.role === 'assistant') {
        next = prev.filter(m => m.id !== id);
      } else {
        return prev;
      }
      // toHistory, not a bare user/assistant filter: the greeting is an
      // assistant bubble, so a plain role filter would replay it to the model.
      historyRef.current = toHistory(next);
      persistSessionMessages(next);
      return next;
    });
  }, [persistSessionMessages]);

  const rebuildHistory = useCallback((msgs: ChatMsg[]) => {
    historyRef.current = toHistory(msgs);
  }, []);

  const editMessage = useCallback(async (id: string, newContent: string) => {
    const trimmed = newContent.trim();
    if (!trimmed || busy || !aiEnabled) return;

    const prev = messagesRef.current;
    const idx = prev.findIndex(m => m.id === id);
    if (idx < 0) return;
    const msg = prev[idx];

    sessionDirtyRef.current = true;

    if (msg.role === 'assistant') {
      const variants = msg.variants ?? [{ content: msg.content, time: msg.time, usage: msg.usage, durationMs: msg.durationMs }];
      variants.push({ content: trimmed, time: new Date() });
      const newIdx = variants.length - 1;
      setMessages(p => {
        const next = p.map(m => m.id === id ? { ...m, content: trimmed, variants, activeVariant: newIdx } : m);
        rebuildHistory(next);
        persistSessionMessages(next);
        return next;
      });
      return;
    }

    if (msg.role !== 'user') return;

    setBusy(true);

    const userVariants = msg.variants ?? [{ content: msg.content, time: msg.time }];
    userVariants.push({ content: trimmed, time: new Date() });
    const newUserIdx = userVariants.length - 1;

    // Update user message with new variant
    setMessages(p => p.map(m => m.id === id
      ? { ...m, content: trimmed, time: new Date(), variants: userVariants, activeVariant: newUserIdx }
      : m));

    // Rebuild history up to this user message. toHistory drops the greeting,
    // which a bare user/assistant filter would keep as a fake first turn.
    const historyBefore = toHistory(prev.slice(0, idx));
    historyBefore.push({ role: 'user', content: trimmed });
    historyRef.current = historyBefore;

    // Find paired assistant message
    const assistantMsg = idx + 1 < prev.length && prev[idx + 1].role === 'assistant' ? prev[idx + 1] : null;
    let pendingAssistantId = assistantMsg?.id ?? null;

    const backend = backendRef.current;
    if (!backend || backend.type !== backendType || backend.status().state !== 'ready') {
      setBusy(false);
      return;
    }

    try {
      let full = '';
      const [instructions, languagePreference] = await Promise.all([
        getAliceInstructions(),
        getResponseLanguagePreference(),
      ]);
      const languageDecision = resolveResponseLanguage({
        message: trimmed,
        preference: languagePreference,
        interfaceLanguage: currentInterfaceLanguage(),
      });
      const generationPreparation = await buildGenerationHistory(
        historyRef.current,
        trimmed,
        backend.type,
        languageDecision.targetLanguage,
        storageCipher,
        backend.allowsAutoContinuation === false,
      );
      // A "one sentence" instruction trims the answer on purpose, so a provider
      // truncation notice would be a false positive, suppress it here too.
      const buffered = requiresBufferedAliceResponse(instructions);
      // allowsAutoContinuation is false under E2EE: assistant turns are dropped
      // rather than sent in clear, so there is no partial answer to extend.
      const allowContinuation = backend.type === 'cloud'
        && backend.allowsAutoContinuation !== false
        && !buffered;

      if (assistantMsg) {
        const aVariants = assistantMsg.variants ?? [{
          content: assistantMsg.content, time: assistantMsg.time,
          usage: assistantMsg.usage, durationMs: assistantMsg.durationMs,
        }];
        aVariants.push({ content: '', time: new Date() });
        const newAIdx = aVariants.length - 1;

        setMessages(p => p.map(m => m.id === assistantMsg.id
          ? { ...m, content: '', variants: aVariants, activeVariant: newAIdx }
          : m));

        const result = await generateLanguageChecked({
          backend,
          history: generationPreparation.history,
            allowContinuation,
          targetLanguage: languageDecision.targetLanguage,
          requestId: backend.type === 'cloud' ? createPrivateCloudRequestId() : undefined,
          onText: buffered ? undefined : visible => {
            setMessages(current => current.map(message => {
              if (message.id !== assistantMsg.id) return message;
              const variants = [...(message.variants ?? [])];
              variants[newAIdx] = { ...(variants[newAIdx] ?? { time: new Date() }), content: visible };
              return { ...message, content: visible, variants };
            }));
          },
        });
        console.info('[alice-turn]', JSON.stringify({
          backend: backend.type,
          ...generationPreparation.diagnostics,
          generationMs: result.durationMs ?? null,
          firstDisplayMs: result.firstDisplayMs ?? null,
          attempts: result.attempts,
          backendTimings: result.backendTimings ?? null,
        }));

        full = applyAliceResponseConstraints(instructions, result.text);
        void rememberAliceCandidates(result.memoryCandidates).catch(() => {});
        setMessages(p => {
          const next = p.map(m => {
            if (m.id !== assistantMsg.id) return m;
            const vs = [...(m.variants ?? [])];
            vs[newAIdx] = { content: full, time: new Date(), usage: result.usage, durationMs: result.durationMs };
            return { ...m, content: full, variants: vs, activeVariant: newAIdx, usage: result.usage, durationMs: result.durationMs, truncated: result.truncated && !buffered };
          });
          persistSessionMessages(next);
          return next;
        });
        historyRef.current.push({ role: 'assistant', content: full });
      } else {
        // No paired assistant message, create one
        const aid = (Date.now() + 1).toString();
        pendingAssistantId = aid;
        setMessages(p => [...p, { id: aid, role: 'assistant' as const, content: '', time: new Date() }]);

        const result = await generateLanguageChecked({
          backend,
          history: generationPreparation.history,
            allowContinuation,
          targetLanguage: languageDecision.targetLanguage,
          requestId: backend.type === 'cloud' ? createPrivateCloudRequestId() : undefined,
          onText: buffered ? undefined : visible => {
            setMessages(current => current.map(message => (
              message.id === aid ? { ...message, content: visible } : message
            )));
          },
        });
        console.info('[alice-turn]', JSON.stringify({
          backend: backend.type,
          ...generationPreparation.diagnostics,
          generationMs: result.durationMs ?? null,
          firstDisplayMs: result.firstDisplayMs ?? null,
          attempts: result.attempts,
          backendTimings: result.backendTimings ?? null,
        }));
        full = applyAliceResponseConstraints(instructions, result.text);
        void rememberAliceCandidates(result.memoryCandidates).catch(() => {});
        setMessages(p => {
          const next = p.map(m => m.id === aid ? { ...m, content: full, usage: result.usage, durationMs: result.durationMs, truncated: result.truncated && !buffered } : m);
          persistSessionMessages(next);
          return next;
        });
        historyRef.current.push({ role: 'assistant', content: full });
      }
    } catch (err) {
      console.warn('[chat] edit re-send failed:', err);
      if (pendingAssistantId) {
        const errorMessage = userFacingSendError(err, backendType);
        const quotaBlocked = quotaBlockOf(err) ?? undefined;
        setMessages(p => {
          const next = p.map(message => {
            if (message.id !== pendingAssistantId) return message;
            if (!message.variants || message.activeVariant == null) {
              return { ...message, content: errorMessage, quotaBlocked };
            }
            const variants = [...message.variants];
            variants[message.activeVariant] = { ...variants[message.activeVariant], content: errorMessage };
            return { ...message, content: errorMessage, variants, quotaBlocked };
          });
          persistSessionMessages(next);
          return next;
        });
      }
    } finally {
      // An edited message spends a request just like a new one, so the
      // displayed balance has to follow it here too.
      if (backendType === 'cloud') {
        account.refreshAccount().catch(() => {});
      }
      setBusy(false);
    }
  }, [account, aiEnabled, backendType, busy, persistSessionMessages, rebuildHistory, storageCipher]);

  const setMessageVariant = useCallback((id: string, variantIndex: number) => {
    sessionDirtyRef.current = true;
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx < 0) return prev;
      const msg = prev[idx];
      if (!msg.variants || variantIndex < 0 || variantIndex >= msg.variants.length) return prev;

      const variant = msg.variants[variantIndex];
      const next = [...prev];
      next[idx] = { ...msg, content: variant.content, time: variant.time, activeVariant: variantIndex, usage: variant.usage, durationMs: variant.durationMs };

      // If user message, also switch paired assistant message
      if (msg.role === 'user' && idx + 1 < prev.length && prev[idx + 1].role === 'assistant') {
        const aMsg = prev[idx + 1];
        if (aMsg.variants && variantIndex < aMsg.variants.length) {
          const aVariant = aMsg.variants[variantIndex];
          next[idx + 1] = { ...aMsg, content: aVariant.content, time: aVariant.time, activeVariant: variantIndex, usage: aVariant.usage, durationMs: aVariant.durationMs };
        }
      }

      rebuildHistory(next);
      persistSessionMessages(next);
      return next;
    });
  }, [persistSessionMessages, rebuildHistory]);

  const value = useMemo(
    () => ({ messages, input, setInput, send, busy, backendType, backendStatus, setBackendType, localAvailable, aiEnabled, setAiEnabled, backendEnabled, setBackendEnabled, clearMessages, showGreeting, sessions, activeSessionId, refreshSessions, openSession, removeSession, cleanSessionHistory, getSessionStorageSummary, deleteMessage, editMessage, setMessageVariant }),
    [messages, input, send, busy, backendType, backendStatus, setBackendType, localAvailable, aiEnabled, setAiEnabled, backendEnabled, setBackendEnabled, clearMessages, showGreeting, sessions, activeSessionId, refreshSessions, openSession, removeSession, cleanSessionHistory, getSessionStorageSummary, deleteMessage, editMessage, setMessageVariant],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
