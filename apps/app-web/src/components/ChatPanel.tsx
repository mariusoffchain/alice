'use client';

import { useEffect, useState } from 'react';
import {
  useChat,
  getCustomServer,
  isTauriDesktop,
  flushProductEvents,
  trackProductEvent,
} from '@alice-wallet/alice-ai';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useQuestionParam } from '@/hooks/use-question-param';
import { ChatMessage } from '@/components/ChatMessage';
import { ExpiryBanner } from '@/components/ExpiryBanner';
import { LearnChatResources } from '@/components/learn/LearnChatResources';
import { defaultLearnLanguage, loadLearnLanguage } from '@/lib/learn/language';
import { loadChatResources, takeChatResources, type LearnChatResources as ChatResources } from '@/lib/learn/suggest-catalog';
import { ChatInput } from '@/components/ChatInput';
import { ModelSelector } from '@/components/ModelSelector';
import { Sidebar, SIDEBAR_ICON_SVG } from '@/components/Sidebar';
import { SvgIcon } from '@/components/SvgIcon';
import { SETTINGS_ICON } from '@/lib/atelier-icons';
import { AliceRabbit } from '@/components/AliceRabbit';
import { useChatRabbit } from '@/hooks/use-chat-rabbit';
import { useOpenSettings } from '@/lib/settings-url';

const SUGGESTIONS = [
  'What is Bitcoin?',
  'How do I secure my wallet?',
  'Explain Lightning Network',
  'What is self-custody?',
];

function LocalNotice() {
  const openSettings = useOpenSettings();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">
      <p
        className="font-numbers text-center max-w-md m-0"
        style={{ fontSize: 20, lineHeight: '26px', color: 'var(--alice-text)' }}
      >
        To use Alice locally, download the app or connect your own server in Settings.
      </p>
      <button
        onClick={() => openSettings('ai')}
        className="alice-control alice-control--primary"
      >
        <SvgIcon svg={SETTINGS_ICON} size={20} /> Open settings
      </button>
    </div>
  );
}

export function ChatPanel() {
  const chat = useChat();
  const { messages, input, setInput, send, busy, clearMessages, showGreeting, backendType, backendStatus, setBackendType, setAiEnabled, aiEnabled, lastRequestFailed } = chat;
  const scrollRef = useAutoScroll([messages, busy]);

  useQuestionParam({
    send,
    setInput,
    backendStatus,
    busy,
    chatReady: messages.length > 0,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  useEffect(() => {
    const desktop = matchMedia('(min-width: 768px)');
    const closeDrawer = () => { if (desktop.matches) setSidebarMobileOpen(false); };
    desktop.addEventListener('change', closeDrawer);
    return () => desktop.removeEventListener('change', closeDrawer);
  }, []);
  const [hasCustomServer, setHasCustomServer] = useState(false);
  // "Pour aller plus loin" resources for the message being sent, computed in
  // the send handler itself: deterministic, immune to effect re-runs and
  // restored history. Re-adopted from the session store on mount, so an
  // Explorer round-trip does not lose the block.
  const [chatResources, setChatResources] = useState<ChatResources | null>(
    () => loadChatResources()?.resources ?? null,
  );
  const [resourcesLang, setResourcesLang] = useState<'fr' | 'en'>(
    () => (loadChatResources()?.lang === 'fr' ? 'fr' : 'en'),
  );
  const [resourcesQuestion, setResourcesQuestion] = useState<string>(
    () => loadChatResources()?.question ?? '',
  );
  const sendWithSuggestion = (text?: string) => {
    const q = (text ?? input).trim();
    if (q) {
      const learnLang = loadLearnLanguage() ?? defaultLearnLanguage(navigator.language);
      setResourcesLang(learnLang === 'fr' ? 'fr' : 'en');
      setResourcesQuestion(q);
      setChatResources(takeChatResources(q, q, learnLang));
    }
    void send(text);
  };

  const showLocalNotice = backendType === 'local' && !hasCustomServer && !isTauriDesktop();

  useEffect(() => {
    if (messages.length === 0) showGreeting();
    getCustomServer().then((cs) => setHasCustomServer(!!cs?.url)).catch(() => {});
    trackProductEvent('app_opened');
    trackProductEvent('chat_opened');
    // Send whatever is still queued before the tab goes away, rather than
    // losing it. visibilitychange is the reliable signal here; unload is not.
    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') void flushProductEvents();
    };
    document.addEventListener('visibilitychange', flushOnHide);
    return () => document.removeEventListener('visibilitychange', flushOnHide);
  }, []);

  const hasUserMessages = messages.some((m) => m.role === 'user');
  const latestUserIndex = messages.reduce((latest, message, index) => (
    message.role === 'user' ? index : latest
  ), -1);
  const assistantReplyStarted = latestUserIndex >= 0 && messages
    .slice(latestUserIndex + 1)
    .some((message) => message.role === 'assistant' && message.content.trim().length > 0);
  const showTypingIndicator = busy && !assistantReplyStarted;

  const available = aiEnabled && backendStatus.state === 'ready' && !showLocalNotice && !lastRequestFailed;
  const rabbitState = useChatRabbit({ input, busy, available, replyStarted: assistantReplyStarted });
  const visible = messages.filter(msg => !(busy && msg.role === 'assistant' && !msg.content));
  const streamingId = busy && assistantReplyStarted
    ? [...visible].reverse().find(m => m.role === 'assistant')?.id : undefined;

  return (
    <div className="atelier-shell flex h-full overflow-hidden">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(v => !v)}
        mobileOpen={sidebarMobileOpen}
        onMobileClose={() => setSidebarMobileOpen(false)}
      />
      <main className="atelier-main flex flex-col flex-1 min-w-0 min-h-0" inert={sidebarMobileOpen}>
        {isTauriDesktop() && <div data-tauri-drag-region className="shrink-0" style={{ height: 28 }} />}
        <ExpiryBanner />
        <button onClick={() => setSidebarMobileOpen(true)} className="alice-control alice-control--tool atelier-mobile-menu md:hidden" aria-label="Open menu" aria-expanded={sidebarMobileOpen}>
          <SvgIcon svg={SIDEBAR_ICON_SVG} size={20} color="var(--alice-muted)" />
        </button>
        <div className="atelier-conversation">
          <div className="atelier-stage">
            <div className="atelier-perch"><AliceRabbit state={rabbitState} connected={available} /></div>
            <div ref={scrollRef} className="atelier-history" role="region" aria-label="Conversation" tabIndex={0}>
              <div className="atelier-messages">
                {showLocalNotice ? <LocalNotice /> : visible.map(msg => (
                  <ChatMessage key={msg.id} message={msg} streaming={msg.id === streamingId} showAvatar={false} />
                ))}
                {!showLocalNotice && showTypingIndicator && <p className="atelier-waiting" role="status">Preparing a response…</p>}
                {!showLocalNotice && <LearnChatResources resources={chatResources} question={resourcesQuestion} messages={messages} busy={busy} lang={resourcesLang} />}
              </div>
            </div>
          </div>
          {!showLocalNotice && !hasUserMessages && messages.length <= 1 && (
            <div className="atelier-suggestions">
              {SUGGESTIONS.map(text => <button type="button" key={text} onClick={() => sendWithSuggestion(text)} disabled={busy || !aiEnabled} title={`Send: ${text}`}>{text}</button>)}
            </div>
          )}
          {!showLocalNotice && <ChatInput input={input} setInput={setInput} onSend={() => sendWithSuggestion()} disabled={busy || !aiEnabled}
            modelSelector={<ModelSelector backendType={backendType} setBackendType={setBackendType} setAiEnabled={setAiEnabled} placement="composer" />} />}
          {showLocalNotice && <div className="chat-composer-shell"><ModelSelector backendType={backendType} setBackendType={setBackendType} setAiEnabled={setAiEnabled} placement="composer" /></div>}
          {(!aiEnabled || lastRequestFailed || backendStatus.state !== 'ready') && <div className="atelier-model-status" role="status">
            {!aiEnabled ? 'AI disabled' : lastRequestFailed ? 'Last request failed' : backendStatus.state === 'loading' ? 'Loading model…' : 'Model unavailable'}
          </div>}
        </div>
      </main>
    </div>
  );
}
