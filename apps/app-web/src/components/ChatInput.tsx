'use client';

import { SendMessageButton } from '@/components/SendMessageButton';
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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (input.trim() && !disabled) onSend();
    }
  };

  return (
    <div className={panel ? 'chat-composer-shell chat-composer-shell--panel' : 'chat-composer-shell'}>
      <div className="chat-composer">
        <textarea
          aria-label="Message Alice"
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Alice something..."
          maxLength={500}
          rows={1}
          className="chat-composer-input w-full min-w-0 resize-none bg-transparent border-none outline-none font-numbers text-lg py-0 placeholder:opacity-100"
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
            <div className="flex min-w-0 flex-1 items-center justify-start">
              {modelSelector}
            </div>
          )}
          <SendMessageButton onClick={onSend} disabled={!input.trim() || disabled} />
        </div>
      </div>
    </div>
  );
}
