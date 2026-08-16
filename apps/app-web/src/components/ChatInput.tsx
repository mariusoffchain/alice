'use client';

import { useRef, useEffect, type ReactNode } from 'react';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  modelSelector?: ReactNode;
  deepMode?: boolean;
  setDeepMode?: (enabled: boolean) => void;
  // Deep only runs on Private Cloud. When false the button is hidden entirely,
  // so the UI can never suggest Deep is active on Local or Custom.
  deepAvailable?: boolean;
  // Panel mode (the Explorer sidebar): the shell drops its max-width and
  // padding so the composer fills its container edge to edge.
  panel?: boolean;
}

// Minimal brain glyph — the app has no icon library, so this matches the
// existing hand-rolled SVG icons (see AliceIcon).
export function BrainIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5a2.5 2.5 0 0 0-5 0 2.5 2.5 0 0 0-2 4 2.5 2.5 0 0 0 1 4.5A2.5 2.5 0 0 0 9.5 19 2.5 2.5 0 0 0 12 16.5Z" />
      <path d="M12 5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 2 4 2.5 2.5 0 0 1-1 4.5 2.5 2.5 0 0 1-2.5 5.5A2.5 2.5 0 0 1 12 16.5Z" />
    </svg>
  );
}

export function ChatInput({
  input,
  setInput,
  onSend,
  disabled,
  modelSelector,
  deepMode,
  setDeepMode,
  deepAvailable = false,
  panel = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '26px';
    el.style.height = Math.min(Math.max(el.scrollHeight, 26), 96) + 'px';
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !disabled) onSend();
    }
  };

  return (
    <div className={panel ? 'chat-composer-shell chat-composer-shell--panel' : 'chat-composer-shell'}>
      <div className="chat-composer">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Alice something..."
          maxLength={500}
          rows={1}
          className="chat-composer-input w-full min-w-0 resize-none bg-transparent border-none outline-none font-numbers text-lg py-0 placeholder:opacity-50"
          style={{
            color: 'var(--alice-text)',
            height: '26px',
            minHeight: 26,
            maxHeight: 96,
            lineHeight: '26px',
            overflowY: input.includes('\n') ? 'auto' : 'hidden',
          }}
        />
        <div className="chat-composer-controls flex min-w-0 items-center justify-end gap-1.5">
          {modelSelector && (
            <div className="hidden min-w-0 flex-1 items-center justify-end md:flex">
              {modelSelector}
            </div>
          )}
          {setDeepMode && deepAvailable && (
            <button
              type="button"
              onClick={() => setDeepMode(!deepMode)}
              aria-pressed={!!deepMode}
              aria-label="Deeper answer"
              title={deepMode
                ? 'Deeper answer on: uses a stronger private cloud model'
                : 'Use a stronger private cloud model for complex questions.'}
              className="flex w-9 h-9 items-center justify-center shrink-0 cursor-pointer transition-colors"
              style={{
                backgroundColor: deepMode ? 'var(--alice-primary)' : 'transparent',
                color: deepMode ? 'var(--alice-on-primary)' : 'var(--alice-muted)',
                border: 'none',
                borderRadius: '2px',
                outline: 'none',
              }}
            >
              <BrainIcon />
            </button>
          )}
          <button
            onClick={onSend}
            disabled={!input.trim() || disabled}
            className="w-9 h-9 flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            style={{
              backgroundColor: 'var(--alice-text)',
              borderRadius: '2px',
            }}
          >
            <span
              className="font-pixel leading-none"
              style={{ color: 'var(--alice-bg)', fontSize: 18, transform: 'translateY(1px)' }}
            >
              ↑
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
