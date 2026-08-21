'use client';

/**
 * Shared building blocks for the settings tabs. Every tab draws from this file
 * so a card in Explorer looks exactly like a card in AI, whichever surface
 * renders it (the dialog over the app, or the /settings route).
 */

export const DANGER = '#e06060';

export const sectionStyle: React.CSSProperties = {
  backgroundColor: 'var(--alice-card-bg)',
  border: '2px solid var(--alice-border)',
  borderRadius: 2,
  padding: 16,
  marginBottom: 16,
};

export const btnBase: React.CSSProperties = {
  fontSize: 10,
  border: '2px solid var(--alice-border)',
  borderRadius: 2,
  cursor: 'pointer',
  outline: 'none',
  letterSpacing: '0.12em',
  padding: '8px 14px',
};

export const inputStyle: React.CSSProperties = {
  fontSize: 15,
  padding: '8px 12px',
  backgroundColor: 'var(--alice-bg)',
  border: '2px solid var(--alice-primary)',
  borderRadius: 2,
  color: 'var(--alice-primary-dark)',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.7,
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
    <p className="font-numbers m-0 mt-1 mb-3" style={{ fontSize: 14, opacity: 0.5 }}>
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
      className="flex items-center cursor-pointer"
      style={{
        minHeight: 36,
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
          border: `2px solid ${enabled ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
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
  pixel = true,
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
      className={pixel ? 'font-pixel tracking-widest' : 'font-numbers cursor-pointer'}
      style={{
        ...btnBase,
        ...(pixel ? null : { fontSize: 14, padding: '8px 16px' }),
        border: `2px solid ${active ? 'var(--alice-primary)' : 'var(--alice-border)'}`,
        backgroundColor: active ? 'var(--alice-primary)' : 'transparent',
        color: active ? 'var(--alice-on-primary)' : 'var(--alice-primary)',
      }}
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
  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 80 }}
      onClick={() => !busy && onCancel()}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          ...sectionStyle,
          marginBottom: 0,
          maxWidth: 420,
          width: '100%',
          backgroundColor: 'var(--alice-bg)',
        }}
      >
        <h3 className="font-pixel tracking-widest m-0" style={{ fontSize: 10, color: DANGER }}>
          {title}
        </h3>
        <p className="font-numbers m-0 mt-3" style={{ fontSize: 15, lineHeight: '20px', opacity: 0.8 }}>
          {body}
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="font-pixel tracking-widest flex-1"
            style={{ ...btnBase, backgroundColor: 'transparent' }}
            disabled={busy}
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className="font-pixel tracking-widest flex-1"
            style={{
              ...btnBase,
              backgroundColor: DANGER,
              color: '#ffffff',
              borderColor: DANGER,
            }}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
