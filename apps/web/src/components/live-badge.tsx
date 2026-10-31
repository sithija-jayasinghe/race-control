import type { LiveStatus } from '@/lib/live';
import { cn } from '@/lib/utils';

const LABELS: Record<LiveStatus, string> = { live: 'Live', connecting: 'Connecting', offline: 'Reconnecting' };

/** The broadcast LIVE tag: red and pulsing while the live channel is up, grey while it reconnects. */
export function LiveBadge({ status, className }: { status: LiveStatus; className?: string }) {
  return (
    <span role="status" className={cn('glass inline-flex items-center gap-2 rounded-xl px-3 py-2', className)}>
      <span
        className={cn(
          'broadcast rounded px-1.5 text-xs',
          status === 'live' ? 'bg-f1 text-white motion-safe:animate-pulse' : 'bg-white/10 text-muted-foreground',
        )}
      >
        {LABELS[status]}
      </span>
      {status !== 'live' && <span className="text-xs text-muted-foreground">updates every 10 s</span>}
    </span>
  );
}
