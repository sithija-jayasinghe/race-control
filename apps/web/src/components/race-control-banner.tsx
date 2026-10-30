import { X } from 'lucide-react';
import { FLAGS, type FlagStatus } from '@/components/status-flag';

/** Banner names for the flags, as Race Control messages show them. */
const TAGS: Partial<Record<FlagStatus, string>> = {
  yellow: 'Yellow flag',
  waiting: 'Pit lane',
  blocked: 'Black flag',
  working: 'Green flag',
};

/** A Race Control message, styled like the broadcast banner. */
export function RaceControlBanner({
  status,
  message,
  detail,
  onDismiss,
}: {
  status: FlagStatus;
  message: string;
  detail?: string;
  onDismiss?: () => void;
}) {
  const color = FLAGS[status].color;
  return (
    <div
      role="status"
      className="flex max-w-full items-stretch overflow-hidden rounded-md border border-glass-line bg-[rgb(8_9_12/0.92)] font-display text-[#eceef2] shadow-[0_16px_40px_rgb(0_0_0/0.5)] motion-safe:animate-[rc-slam_0.45s_cubic-bezier(.2,.9,.2,1)]"
    >
      <span className="broadcast flex items-center px-2.5 text-xs whitespace-nowrap text-[#0b0c0f]" style={{ background: color }}>
        {TAGS[status] ?? FLAGS[status].label}
      </span>
      <span className="hidden items-center border-r border-white/10 px-2.5 text-xs font-bold tracking-[0.1em] whitespace-nowrap text-[#8b909a] sm:flex">
        RACE CONTROL
      </span>
      <span className="flex min-w-0 items-center gap-2.5 px-3 py-1.5 text-[13px] font-bold tracking-[0.03em] uppercase sm:text-sm">
        <span className="truncate">{message}</span>
        {detail && (
          <span className="hidden font-mono text-xs font-normal tracking-normal whitespace-nowrap normal-case text-[#8b909a] sm:inline">
            {detail}
          </span>
        )}
      </span>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex min-w-10 items-center justify-center border-l border-white/10 text-[#8b909a] hover:text-[#eceef2]"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
