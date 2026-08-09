'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AliceIcon } from '@/components/AliceIcon';
import { useChat } from '@alice-wallet/alice-ai';
import type { TokenUsage, MessageVariant } from '@alice-wallet/alice-ai';

interface ChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    time: Date;
    usage?: TokenUsage;
    durationMs?: number;
    truncated?: boolean;
    deep?: boolean;
    variants?: MessageVariant[];
    activeVariant?: number;
  };
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  return text.split(/(\*\*.+?\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={index}
          style={{
            fontFamily: 'monospace',
            fontSize: '0.9em',
            padding: '1px 4px',
            borderRadius: 3,
            backgroundColor: 'var(--alice-card-bg)',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function ChatMarkdownText({ content }: { content: string }) {
  const lines = (content || '...').split('\n');

  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, index) => {
        // Headings: models reach for them even when asked not to, so render
        // them rather than leaking "###" into the bubble.
        const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/);
        if (heading) {
          return (
            <p
              key={index}
              className="m-0 mt-2 first:mt-0"
              style={{ fontWeight: 700, fontSize: heading[1].length <= 2 ? '1.15em' : '1.05em' }}
            >
              {renderInlineMarkdown(heading[2])}
            </p>
          );
        }

        // Table rows. The |---|---| separator carries no content: drop it.
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return null;
        const tableRow = line.match(/^\s*\|(.+)\|\s*$/);
        if (tableRow) {
          const cells = tableRow[1].split('|').map(c => c.trim());
          return (
            <div key={index} className="flex flex-col gap-0.5 my-1">
              {cells.map((cell, cellIndex) => (
                <div key={cellIndex} className={cellIndex === 0 ? '' : 'pl-3'} style={{ opacity: cellIndex === 0 ? 1 : 0.85 }}>
                  {cellIndex === 0 ? <strong>{renderInlineMarkdown(cell)}</strong> : renderInlineMarkdown(cell)}
                </div>
              ))}
            </div>
          );
        }

        const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
        if (numbered) {
          return (
            <div key={index} className="flex items-start gap-1.5">
              <span className="shrink-0" style={{ minWidth: '1.25em' }}>{numbered[1]}.</span>
              <span className="flex-1">{renderInlineMarkdown(numbered[2])}</span>
            </div>
          );
        }

        const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={index} className="flex items-start gap-1.5">
              <span className="w-3 text-center shrink-0">&bull;</span>
              <span className="flex-1">{renderInlineMarkdown(bullet[1])}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={index} className="h-1.5" />;
        return <p key={index} className="m-0">{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

// Shown when the provider stopped on max_tokens: the answer ends mid-thought,
// so say so rather than letting it look like Alice finished.
function TruncatedNotice() {
  return (
    <div
      className="font-numbers mt-2"
      style={{
        fontSize: 14,
        lineHeight: '20px',
        opacity: 0.6,
        paddingTop: 8,
        borderTop: '1px solid var(--alice-border)',
      }}
    >
      This answer is unusually long and still isn&apos;t finished. Ask Alice to continue and
      she&apos;ll pick up where she stopped.
    </div>
  );
}

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 30) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

// --- Icon components (inline SVG, no dependencies) ---

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8v-2a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5l10-10" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7l16 0" />
      <path d="M10 11l0 6" />
      <path d="M14 11l0 6" />
      <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7h-1a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1" />
      <path d="M20.385 6.585a2.1 2.1 0 0 0-2.97-2.97l-8.415 8.385v3h3l8.385-8.415z" />
      <path d="M16 5l3 3" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
      <path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M13.41 10.59l2.59 -2.59" />
      <path d="M7 12a5 5 0 0 1 5 -5" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="M6 11l6-6l6 6" />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="M18 13l-6 6l-6-6" />
    </svg>
  );
}

function SigmaIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6H6l7 6l-7 6h12" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6l6 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6l-6 6" />
    </svg>
  );
}

function VariantNav({ messageId, variants, activeVariant }: { messageId: string; variants: MessageVariant[]; activeVariant: number }) {
  const { setMessageVariant } = useChat();
  if (variants.length < 2) return null;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 4 }}>
      <button
        onClick={() => setMessageVariant(messageId, activeVariant - 1)}
        disabled={activeVariant === 0}
        style={{
          background: 'none', border: 'none', cursor: activeVariant === 0 ? 'default' : 'pointer',
          padding: 2, display: 'flex', alignItems: 'center',
          color: 'var(--alice-text)', opacity: activeVariant === 0 ? 0.15 : 0.5,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => { if (activeVariant > 0) e.currentTarget.style.opacity = '0.8'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = activeVariant === 0 ? '0.15' : '0.5'; }}
      >
        <ChevronLeftIcon />
      </button>
      <span style={{ fontSize: 10, color: 'var(--alice-text)', opacity: 0.4, fontFamily: 'var(--font-numbers, monospace)', minWidth: 20, textAlign: 'center' }}>
        {activeVariant + 1}/{variants.length}
      </span>
      <button
        onClick={() => setMessageVariant(messageId, activeVariant + 1)}
        disabled={activeVariant === variants.length - 1}
        style={{
          background: 'none', border: 'none', cursor: activeVariant === variants.length - 1 ? 'default' : 'pointer',
          padding: 2, display: 'flex', alignItems: 'center',
          color: 'var(--alice-text)', opacity: activeVariant === variants.length - 1 ? 0.15 : 0.5,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => { if (activeVariant < variants.length - 1) e.currentTarget.style.opacity = '0.8'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = activeVariant === variants.length - 1 ? '0.15' : '0.5'; }}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

// --- Action button ---

function ActionButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        display: 'flex',
        alignItems: 'center',
        color: 'var(--alice-text)',
        opacity: 0.35,
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.35'; }}
    >
      {children}
    </button>
  );
}

// --- Token metrics tooltip ---

function MetricRow({ icon, label, value, unit, primary }: { icon: React.ReactNode; label: string; value: string; unit: string; primary?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <span style={{ fontSize: 13, color: 'var(--alice-text)', opacity: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 12, height: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.7 }}>
          {icon}
        </span>
        {label}
      </span>
      <span style={{
        fontSize: 13,
        fontFamily: 'monospace',
        color: 'var(--alice-text)',
        opacity: primary ? 0.9 : 0.6,
      }}>
        {value} <span style={{ opacity: 0.5 }}>{unit}</span>
      </span>
    </div>
  );
}

function TokenTooltip({ usage, durationMs }: { usage?: TokenUsage; durationMs?: number }) {
  const [show, setShow] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  if (!usage && !durationMs) return null;

  const speed = usage?.completionTokens && durationMs
    ? (usage.completionTokens / (durationMs / 1000)).toFixed(1)
    : null;
  const duration = durationMs ? (durationMs / 1000).toFixed(1) : null;

  const handleEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShow(true);
  };
  const handleLeave = () => {
    hideTimer.current = setTimeout(() => setShow(false), 150);
  };

  return (
    <div className="relative" style={{ display: 'inline-flex' }}>
      <div
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        style={{
          cursor: 'pointer',
          opacity: show ? 0.7 : 0.35,
          transition: 'opacity 0.15s',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          color: 'var(--alice-text)',
        }}
      >
        <GaugeIcon />
      </div>

      {show && (
        <div
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          style={{
            position: 'absolute',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--alice-bg)',
            border: '1px solid var(--alice-border, rgba(255,255,255,0.15))',
            borderRadius: 8,
            padding: '10px 14px',
            minWidth: 210,
            zIndex: 50,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {speed && <MetricRow icon={<BoltIcon />} label="Speed" value={speed} unit="tokens/s" primary />}
            {duration && <MetricRow icon={<ClockIcon />} label="Duration" value={duration} unit="s" primary />}
            {(usage?.promptTokens != null || usage?.completionTokens != null) && (
              <div style={{ borderTop: '1px solid var(--alice-border, rgba(255,255,255,0.1))', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {usage?.promptTokens != null && <MetricRow icon={<ArrowUpIcon />} label="Prompt" value={String(usage.promptTokens)} unit="tokens" />}
                {usage?.completionTokens != null && <MetricRow icon={<ArrowDownIcon />} label="Completion" value={String(usage.completionTokens)} unit="tokens" />}
                {usage?.totalTokens != null && <MetricRow icon={<SigmaIcon />} label="Total" value={String(usage.totalTokens)} unit="tokens" primary />}
              </div>
            )}
          </div>
          <div style={{
            position: 'absolute',
            bottom: -5,
            left: '50%',
            marginLeft: -5,
            width: 10,
            height: 10,
            backgroundColor: 'var(--alice-bg)',
            borderRight: '1px solid var(--alice-border, rgba(255,255,255,0.15))',
            borderBottom: '1px solid var(--alice-border, rgba(255,255,255,0.15))',
            transform: 'rotate(45deg)',
          }} />
        </div>
      )}
    </div>
  );
}

// --- Edit mode inline ---

function EditableContent({ content, onSave, onCancel }: { content: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave(text);
    }
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => {
          setText(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = e.target.scrollHeight + 'px';
        }}
        onKeyDown={handleKeyDown}
        className="font-numbers text-lg leading-[26px]"
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px solid var(--alice-border)',
          borderRadius: 4,
          padding: '6px 8px',
          color: 'var(--alice-text)',
          resize: 'none',
          outline: 'none',
          minHeight: 36,
        }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          className="font-numbers text-sm"
          style={{
            background: 'none',
            border: '1px solid var(--alice-border)',
            borderRadius: 4,
            padding: '3px 10px',
            color: 'var(--alice-text)',
            cursor: 'pointer',
            opacity: 0.6,
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(text)}
          className="font-numbers text-sm"
          style={{
            background: 'var(--alice-accent, #6cf)',
            border: 'none',
            borderRadius: 4,
            padding: '3px 10px',
            color: '#000',
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// --- Action bar ---

function MessageActions({
  message,
  onEdit,
}: {
  message: ChatMessageProps['message'];
  onEdit: () => void;
}) {
  const { deleteMessage } = useChat();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [message.content]);

  const isUser = message.role === 'user';
  const time = message.time instanceof Date ? message.time : new Date(message.time);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        paddingLeft: isUser ? 0 : 42,
        paddingTop: 2,
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--alice-text)', opacity: 0.3, marginRight: 4, fontFamily: 'var(--font-numbers, monospace)' }}>
        {relativeTime(time)}
      </span>

      {!isUser && message.deep && (
        <span
          className="font-pixel tracking-widest"
          title="Answered with Deep (Private Cloud)"
          style={{
            fontSize: 7,
            lineHeight: 1,
            padding: '3px 5px',
            marginRight: 4,
            border: '1px solid var(--alice-primary)',
            borderRadius: 2,
            color: 'var(--alice-primary)',
          }}
        >
          DEEP
        </span>
      )}

      {message.variants && message.variants.length > 1 && (
        <VariantNav
          messageId={message.id}
          variants={message.variants}
          activeVariant={message.activeVariant ?? 0}
        />
      )}

      <ActionButton onClick={handleCopy} title="Copy">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </ActionButton>

      <ActionButton onClick={onEdit} title="Edit">
        <EditIcon />
      </ActionButton>

      <ActionButton onClick={() => deleteMessage(message.id)} title="Delete">
        <TrashIcon />
      </ActionButton>

      {!isUser && (
        <TokenTooltip usage={message.usage} durationMs={message.durationMs} />
      )}
    </div>
  );
}

// --- Main component ---

export function ChatMessage({ message }: ChatMessageProps) {
  const { editMessage } = useChat();
  const [editing, setEditing] = useState(false);

  if (message.role === 'system') {
    return (
      <div className="flex justify-center py-1">
        <p
          className="font-pixel text-[6px] tracking-widest opacity-70 text-center"
          style={{ color: 'var(--alice-text)' }}
        >
          {message.content}
        </p>
      </div>
    );
  }

  const isUser = message.role === 'user';

  const handleSave = (newContent: string) => {
    setEditing(false);
    if (newContent.trim() && newContent.trim() !== message.content) {
      editMessage(message.id, newContent);
    }
  };

  return (
    <div>
      <div className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {!isUser && (
          <div className="w-[30px] h-[30px] shrink-0 flex items-end">
            <AliceIcon size={30} color="var(--alice-text)" />
          </div>
        )}
        <div
          className={`${isUser ? 'max-w-[75%] rounded-sm px-3.5 py-2.5' : 'flex-1 min-w-0'}`}
          style={isUser ? { backgroundColor: 'var(--alice-card-bg)' } : undefined}
        >
          {editing ? (
            <EditableContent
              content={message.content}
              onSave={handleSave}
              onCancel={() => setEditing(false)}
            />
          ) : isUser ? (
            <p
              className="font-numbers text-lg leading-[26px] m-0"
              style={{ color: 'var(--alice-text)' }}
            >
              {message.content || '...'}
            </p>
          ) : (
            <div
              className="font-numbers text-lg leading-[26px]"
              style={{ color: 'var(--alice-text)' }}
            >
              <ChatMarkdownText content={message.content} />
              {message.truncated && <TruncatedNotice />}
            </div>
          )}
        </div>
      </div>
      {!editing && message.content && message.id !== 'greeting' && (
        <MessageActions message={message} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}
