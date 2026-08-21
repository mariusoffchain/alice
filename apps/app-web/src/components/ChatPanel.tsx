'use client';

import { useEffect, useState } from 'react';
import {
  useAccount,
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
import { AliceIcon } from '@/components/AliceIcon';
import { useOpenSettings } from '@/lib/settings-url';
import { NEW_CHAT_ICON_SVG } from '@alice-wallet/alice-ui/components/new-chat-icon-svg';

const SUGGESTIONS = [
  'What is Bitcoin?',
  'How do I secure my wallet?',
  'Explain Lightning Network',
  'What is self-custody?',
];

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 px-5 py-1">
      <div className="w-[30px] h-[30px] shrink-0 flex items-end">
        <AliceIcon size={30} color="var(--alice-primary)" />
      </div>
      <div className="flex items-center gap-1.5 py-2">
        {[0, 0.2, 0.4].map((delay) => (
          <span
            key={delay}
            className="w-1.5 h-1.5 rounded-full animate-bounce"
            style={{
              backgroundColor: 'var(--alice-muted)',
              animationDelay: `${delay}s`,
              animationDuration: '1.4s',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function LocalNotice() {
  const openSettings = useOpenSettings();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">
      <AliceIcon size={44} color="var(--alice-primary)" />
      <p
        className="font-numbers text-center max-w-md m-0"
        style={{ fontSize: 20, lineHeight: '26px', color: 'var(--alice-text)' }}
      >
        To use Alice locally, download the app or connect your own server in Settings.
      </p>
      <button
        onClick={() => openSettings('ai')}
        className="font-pixel tracking-widest cursor-pointer"
        style={{
          fontSize: 10,
          padding: '8px 20px',
          border: '2px solid var(--alice-primary)',
          borderRadius: 2,
          backgroundColor: 'transparent',
          color: 'var(--alice-primary)',
        }}
      >
        GO TO SETTINGS
      </button>
    </div>
  );
}

export function ChatPanel() {
  const chat = useChat();
  const account = useAccount();
  const { messages, input, setInput, send, busy, clearMessages, showGreeting, backendType, backendStatus, setBackendType, setAiEnabled } = chat;
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

  return (
    // h-dvh, not h-screen: on mobile Safari 100vh ignores the address bar and
    // pushes the composer off-screen.
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: 'var(--alice-bg)' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        mobileOpen={sidebarMobileOpen}
        onMobileClose={() => setSidebarMobileOpen(false)}
      />

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {isTauriDesktop() && (
          <div data-tauri-drag-region className="shrink-0" style={{ height: 28 }} />
        )}
        {/* Above everything else in the column: a plan that is about to lapse
            is worth saying before the conversation, not after it. */}
        <ExpiryBanner />
        <div
          className="grid shrink-0 grid-cols-[108px_minmax(0,1fr)_108px] items-center px-3 md:hidden"
          style={{
            height: 'calc(52px + env(safe-area-inset-top))',
            paddingTop: 'env(safe-area-inset-top)',
          }}
        >
          <div className="flex items-center">
            <button
              onClick={() => setSidebarMobileOpen(true)}
              className="w-9 h-9 flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Open menu"
            >
              <SvgIcon svg={SIDEBAR_ICON_SVG} size={18} color="var(--alice-primary)" />
            </button>
          </div>

          <div className="flex min-w-0 items-center justify-center">
            <ModelSelector
              backendType={backendType}
              setBackendType={setBackendType}
              setAiEnabled={setAiEnabled}
              compactLabel
              placement="mobile-header"
            />
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                clearMessages();
                setSidebarMobileOpen(false);
              }}
              className="w-9 h-9 flex items-center justify-center cursor-pointer"
              aria-label="New chat"
              title="New chat"
            >
              <SvgIcon svg={NEW_CHAT_ICON_SVG} size={19} color="var(--alice-primary)" />
            </button>
          </div>
        </div>
        {showLocalNotice ? (
          <LocalNotice />
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {!hasUserMessages && messages.length <= 1 ? (
                <div
                  className="max-w-4xl mx-auto flex flex-col gap-6 px-5 pt-10 pb-2"
                  style={{ minHeight: '100%', justifyContent: 'flex-start' }}
                >
                  <div className="flex flex-col gap-3">
                    {messages.map((msg) => (
                      <ChatMessage key={msg.id} message={msg} />
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                    {SUGGESTIONS.map((text) => (
                      <button
                        key={text}
                        onClick={() => sendWithSuggestion(text)}
                        disabled={busy}
                        className="text-left font-numbers text-sm px-4 py-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:bg-white/15"
                        style={{
                          color: 'var(--alice-text)',
                          border: '2px solid var(--alice-border)',
                          borderRadius: '2px',
                          backgroundColor: 'transparent',
                        }}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto flex flex-col gap-3 px-5 pt-3 pb-2" style={{ minHeight: '100%', justifyContent: 'flex-end' }}>
                  {(() => {
                    const visible = messages.filter((msg) => !(busy && msg.role === 'assistant' && !msg.content));
                    // Terminal cursor on the reply being written: the last
                    // assistant bubble while the request is still in flight.
                    const streamingId = busy && assistantReplyStarted
                      ? [...visible].reverse().find((m) => m.role === 'assistant')?.id
                      : undefined;
                    return visible.map((msg) => (
                      <ChatMessage key={msg.id} message={msg} streaming={msg.id === streamingId} />
                    ));
                  })()}
                  {showTypingIndicator && <TypingIndicator />}
                  <LearnChatResources resources={chatResources} question={resourcesQuestion} messages={messages} busy={busy} lang={resourcesLang} />
                </div>
              )}
            </div>

            <ChatInput
              input={input}
              setInput={setInput}
              onSend={() => sendWithSuggestion()}
              disabled={busy}
              modelSelector={(
                <ModelSelector
                  backendType={backendType}
                  setBackendType={setBackendType}
                  setAiEnabled={setAiEnabled}
                />
              )}
            />
          </>
        )}
      </div>
    </div>
  );
}
