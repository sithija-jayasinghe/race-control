import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** Elapsed time as HH:MM:SS. Hours keep counting past 24. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  return parts.map((n) => String(n).padStart(2, '0')).join(':');
}

/** The LIVE tag and session clock from the broadcast. */
export function LiveClock({ since, className }: { since: Date; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={cn('glass inline-flex items-center gap-2 rounded-xl px-3 py-2', className)}>
      <span className="broadcast rounded bg-f1 px-1.5 text-xs text-white">Live</span>
      <time className="font-mono text-[13px] tabular-nums" aria-label="Session time">
        {formatElapsed(now - since.getTime())}
      </time>
    </span>
  );
}
