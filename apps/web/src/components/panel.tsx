import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A glass panel with a broadcast header and kerb stripe, as used by the timing tower. */
export function Panel({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('glass overflow-hidden rounded-xl', className)}>
      <header className="flex items-center justify-between gap-3 bg-black/30 px-4 py-2.5">
        <h2 id={headingId} className="broadcast text-[13px]">
          {title}
        </h2>
        {aside}
      </header>
      <div className="kerb" aria-hidden="true" />
      {children}
    </section>
  );
}
