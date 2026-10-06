'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Shared building blocks for the settings tabs. Every tab draws from this file
 * so a card in Explorer looks exactly like a card in AI, whichever surface
 * renders it (the dialog over the app, or the /settings route).
 */

/** Keep keyboard navigation inside the uppermost dialog and restore its trigger. */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    if (!root) return;
    const selector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';
    root.querySelector<HTMLElement>(selector)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      if (dialogs[dialogs.length - 1] !== root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(item => item.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, ref]);
}

export const DANGER = 'var(--alice-danger)';

export const sectionStyle: React.CSSProperties = {
  backgroundColor: 'transparent',
  borderBottom: '1px solid var(--alice-border)',
  padding: '8px 0 24px',
  marginBottom: 24,
};

export const btnBase: React.CSSProperties = {
  fontFamily: 'var(--alice-font-reading)',
};

export const inputStyle: React.CSSProperties = {
  fontSize: 15,
  fontFamily: 'var(--alice-font-reading)',
  minHeight: 40,
  padding: '8px 12px',
  backgroundColor: 'transparent',
  border: '1px solid var(--alice-control-border)',
  borderRadius: 'var(--alice-radius-control)',
  color: 'var(--alice-text)',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 1,
  letterSpacing: '0.15em',
  marginBottom: 8,
};

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-pixel tracking-widest m-0" style={labelStyle}>
      {children}
    </h3>
  );
}

/** Body copy under a section label. */
export function SectionHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-numbers m-0 mt-1 mb-3" style={{ fontSize: 14, color: 'var(--alice-muted)' }}>
      {children}
    </p>
  );
}

export function PixelSwitch({
  label,
  enabled,
  onChange,
  disabled = false,
}: {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className="alice-control alice-control--quiet flex items-center cursor-pointer"
      style={{
        minHeight: 44,
        padding: 0,
        border: 0,
        background: 'transparent',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span
        className="flex items-center"
        style={{
          width: 52,
          height: 28,
          padding: 3,
          border: `2px solid ${enabled ? 'var(--alice-primary)' : 'var(--alice-control-border)'}`,
          borderRadius: 0,
          backgroundColor: enabled ? 'var(--alice-primary)' : 'transparent',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            marginLeft: enabled ? 24 : 0,
            borderRadius: 0,
            backgroundColor: enabled ? 'var(--alice-on-primary)' : 'var(--alice-muted)',
            transition: 'margin-left 140ms ease',
          }}
        />
      </span>
    </button>
  );
}

/** A pill button used for the mutually exclusive choices (language, unit). */
export function ChoiceButton({
  active,
  label,
  pixel: _pixel = false,
  onClick,
}: {
  active: boolean;
  label: string;
  pixel?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="alice-control alice-control--choice font-numbers"
    >
      {label}
    </button>
  );
}

/** Confirmation shown over the settings surface before a destructive action. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(true, dialogRef);
  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 80 }}
      onClick={() => !busy && onCancel()}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={event => {
          if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel(); }
        }}
        onClick={(event) => event.stopPropagation()}
        style={{
          ...sectionStyle,
          marginBottom: 0,
          padding: 24,
          border: '1px solid var(--alice-border)',
          maxWidth: 420,
          width: '100%',
          backgroundColor: 'var(--alice-bg)',
        }}
      >
        <h3 className="font-pixel tracking-widest m-0" style={{ fontSize: 10, color: DANGER }}>
          {title}
        </h3>
        <p className="font-numbers m-0 mt-3" style={{ fontSize: 15, lineHeight: '20px', opacity: 1 }}>
          {body}
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="alice-control alice-control--quiet font-numbers flex-1"
            disabled={busy}
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className="alice-control alice-control--danger font-numbers flex-1"
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
