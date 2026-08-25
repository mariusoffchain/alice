'use client';

import { useRef, useEffect, type ReactNode } from 'react';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  modelSelector?: ReactNode;
  // Panel mode (the Explorer sidebar): the shell drops its max-width and
  // padding so the composer fills its container edge to edge.
  panel?: boolean;
}

// Minimal brain glyph, the app has no icon library, so this matches the
// existing hand-rolled SVG icons (see AliceIcon).
export function ChatInput({
  input,
  setInput,
  onSend,
  disabled,
  modelSelector,
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
          <button
            onClick={onSend}
            disabled={!input.trim() || disabled}
            className="px-raise w-9 h-9 flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--alice-primary)',
              borderRadius: '2px',
            }}
          >
            <span
              className="font-pixel leading-none"
              style={{ color: 'var(--alice-on-primary)', fontSize: 18, transform: 'translateY(1px)' }}
            >
              ↑
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
