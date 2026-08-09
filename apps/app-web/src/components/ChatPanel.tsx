'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useChat,
  useAccount,
  getCustomServer,
  isTauriDesktop,
  flushProductEvents,
  trackProductEvent,
} from '@alice-wallet/alice-ai';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { ChatMessage } from '@/components/ChatMessage';
import { ChatInput } from '@/components/ChatInput';
import { ModelSelector } from '@/components/ModelSelector';
import { Sidebar, SIDEBAR_ICON_SVG } from '@/components/Sidebar';
import { SvgIcon } from '@/components/SvgIcon';
import { AliceIcon } from '@/components/AliceIcon';
import { CLOCK_ICON_SVG } from '@alice-wallet/alice-ui/components/clock-icon-svg';

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
        <AliceIcon size={30} color="var(--alice-text)" />
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
  const router = useRouter();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8">
      <AliceIcon size={44} color="var(--alice-text)" />
      <p
        className="font-numbers text-center max-w-md m-0"
        style={{ fontSize: 20, lineHeight: '26px', color: 'var(--alice-text)' }}
      >
        To use Alice locally, download the app or connect your own server in Settings.
      </p>
      <button
        onClick={() => router.push('/settings')}
        className="font-pixel tracking-widest cursor-pointer"
        style={{
          fontSize: 8,
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
  const { messages, input, setInput, send, busy, deepMode, setDeepMode, clearMessages, showGreeting, backendType, setBackendType, setAiEnabled } = chat;
  const scrollRef = useAutoScroll([messages, busy]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [hasCustomServer, setHasCustomServer] = useState(false);

  const showLocalNotice = backendType === 'local' && !hasCustomServer && !isTauriDesktop();
  // Deep only exists on Private Cloud. Leaving cloud clears it so the toggle
  // can never stay silently armed behind a local or custom backend.
  const deepAvailable = backendType === 'cloud'
    && (account.account?.deep_research_credits ?? 0) > 0;

  useEffect(() => {
    if (!deepAvailable && deepMode) setDeepMode(false);
  }, [deepAvailable, deepMode, setDeepMode]);

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
    <div className="flex h-dvh" style={{ backgroundColor: 'var(--alice-bg)' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        mobileOpen={sidebarMobileOpen}
        onMobileClose={() => setSidebarMobileOpen(false)}
      />

      <div className="flex flex-col flex-1 min-w-0">
        {isTauriDesktop() && (
          <div data-tauri-drag-region className="shrink-0" style={{ height: 28 }} />
        )}
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
              <SvgIcon svg={SIDEBAR_ICON_SVG} size={18} color="var(--alice-text)" />
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
              onClick={() => setSidebarMobileOpen(true)}
              className="w-9 h-9 flex items-center justify-center cursor-pointer"
              aria-label="Conversation history"
              title="Conversation history"
            >
              <SvgIcon svg={CLOCK_ICON_SVG} size={19} color="var(--alice-text)" />
            </button>
            <button
              type="button"
              onClick={() => {
                clearMessages();
                setSidebarMobileOpen(false);
              }}
              className="w-9 h-9 flex items-center justify-center cursor-pointer"
              aria-label="New chat"
              title="New chat"
              style={{ color: 'var(--alice-text)' }}
            >
              <span className="font-pixel text-base">+</span>
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
                        onClick={() => send(text)}
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
                  {messages
                    .filter((msg) => !(busy && msg.role === 'assistant' && !msg.content))
                    .map((msg) => (
                      <ChatMessage key={msg.id} message={msg} />
                    ))}
                  {showTypingIndicator && <TypingIndicator />}
                </div>
              )}
            </div>

            <ChatInput
              input={input}
              setInput={setInput}
              onSend={() => send()}
              disabled={busy}
              deepMode={deepMode}
              setDeepMode={setDeepMode}
              deepAvailable={deepAvailable}
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
