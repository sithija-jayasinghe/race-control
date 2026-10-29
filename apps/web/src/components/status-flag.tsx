import { cn } from '@/lib/utils';

export type FlagStatus = 'working' | 'yellow' | 'waiting' | 'blocked' | 'idle';

// docs/design/UI.md: every status has a word as well as a colour, so it never relies on colour alone.
export const FLAGS: Record<FlagStatus, { label: string; color: string }> = {
  working: { label: 'Working', color: 'var(--flag-green)' },
  yellow: { label: 'Yellow flag', color: 'var(--flag-yellow)' },
  waiting: { label: 'Pit lane', color: 'var(--flag-blue)' },
  blocked: { label: 'Black flag', color: 'var(--flag-red)' },
  idle: { label: 'Idle', color: 'var(--flag-idle)' },
};

/** A glowing dot, plus the flag's name unless `hideLabel` (then it's read out to screen readers only). */
export function StatusFlag({
  status,
  hideLabel = false,
  className,
}: {
  status: FlagStatus;
  hideLabel?: boolean;
  className?: string;
}) {
  const { label, color } = FLAGS[status];
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm', className)} style={{ color }}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-current shadow-[0_0_10px_currentColor]"
      />
      <span className={cn('text-foreground', hideLabel && 'sr-only')}>{label}</span>
    </span>
  );
}
