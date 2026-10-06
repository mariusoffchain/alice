import { SvgIcon } from '@/components/SvgIcon';
import { UP_ICON } from '@/lib/atelier-icons';

/** Shared visual control; callers retain their own send and privacy guards. */
export function SendMessageButton({ onClick, disabled, label = 'Send message' }: {
  onClick: () => void;
  disabled: boolean;
  label?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="alice-control alice-control--primary alice-control--send">
      <SvgIcon svg={UP_ICON} size={20} />
    </button>
  );
}
