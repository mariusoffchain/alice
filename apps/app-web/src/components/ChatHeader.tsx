'use client';

import { useRouter } from 'next/navigation';
import { SETTINGS_SVG } from '@alice-wallet/alice-ui/components/settings-icon-svg';
import { CLOCK_ICON_SVG } from '@alice-wallet/alice-ui/components/clock-icon-svg';
import { SvgIcon } from '@/components/SvgIcon';

interface ChatHeaderProps {
  onNewChat: () => void;
  onToggleHistory: () => void;
  historyOpen: boolean;
}

export function ChatHeader({
  onNewChat,
  onToggleHistory,
  historyOpen,
}: ChatHeaderProps) {
  const router = useRouter();

  return (
    <header
      className="flex items-center justify-between px-5 h-12 shrink-0"
      style={{ backgroundColor: 'var(--alice-bg)' }}
    >
      <button
        onClick={() => router.push('/settings')}
        className="w-9 h-9 flex items-center justify-center cursor-pointer"
        aria-label="Settings"
      >
        <SvgIcon svg={SETTINGS_SVG} size={24} color="var(--alice-text)" />
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <button
          onClick={onToggleHistory}
          className="w-9 h-9 flex items-center justify-center cursor-pointer"
          aria-label="Toggle history"
          style={{ opacity: historyOpen ? 0.6 : 1 }}
        >
          <SvgIcon svg={CLOCK_ICON_SVG} size={20} color="var(--alice-text)" />
        </button>
        <button
          onClick={onNewChat}
          className="w-9 h-9 flex items-center justify-center cursor-pointer"
          style={{ color: 'var(--alice-text)' }}
        >
          <span className="font-pixel text-base">+</span>
        </button>
      </div>
    </header>
  );
}
