import { cn } from '@/lib/utils';

/** The Race Control logo: a skewed checkered flag and the italic wordmark. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Race Control" className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className="h-[18px] w-[26px] -skew-x-12 rounded-[2px] bg-[conic-gradient(#fff_0_25%,#0b0c0f_0_50%,#fff_0_75%,#0b0c0f_0)] bg-[length:9px_9px] ring-1 ring-black/20 dark:ring-white/10"
      />
      <span className="broadcast text-[19px] leading-none tracking-[0.02em]">
        Race <span className="text-f1">/</span> Control
      </span>
    </span>
  );
}
