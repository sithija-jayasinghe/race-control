import { cn } from '@/lib/utils';

const BARS = [-0.1, -0.5, -0.3, -0.7, -0.2, -0.6, -0.4];

/** A Team Radio heads-up between two agents, shown like F1 driver radio. */
export function TeamRadioCard({
  from,
  to,
  quote,
  className,
}: {
  from: string;
  to: string;
  quote: string;
  className?: string;
}) {
  return (
    <div role="status" className={cn('glass flex items-center gap-3 rounded-xl px-3.5 py-3', className)}>
      <span aria-hidden="true" className="flex h-7 items-center gap-0.5">
        {BARS.map((delay) => (
          <i
            key={delay}
            className="h-1 w-[3px] rounded-full bg-foreground motion-safe:animate-[rc-wave_0.9s_ease-in-out_infinite]"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
      <span className="min-w-0">
        <span className="broadcast block text-[13px]">
          <span className="mr-1.5 text-f1">Team radio</span>
          {from} → {to}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">“{quote}”</span>
      </span>
    </div>
  );
}
