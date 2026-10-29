import { cn } from '@/lib/utils';

/** The F1 start gantry: five pods of two red lights. `lit` is how many pods are on (0 to 5). */
export function StartLights({ lit, size = 'lg', className }: { lit: number; size?: 'sm' | 'lg'; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex justify-center rounded-xl border border-white/10 bg-[#0d0f13]',
        size === 'lg' ? 'gap-4 px-5 py-4 sm:gap-[18px]' : 'gap-2 px-3 py-2.5',
        className,
      )}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={cn('flex flex-col rounded-lg bg-[#08090b]', size === 'lg' ? 'gap-2.5 p-2.5' : 'gap-1.5 p-1.5')}>
          {[0, 1].map((j) => (
            <span
              key={j}
              data-lit={i < lit}
              className={cn(
                'rounded-full bg-[#1a0b0b] transition-[background,box-shadow] duration-75',
                size === 'lg' ? 'size-7 sm:size-[34px]' : 'size-3.5',
                i < lit && 'bg-f1 shadow-[0_0_22px_var(--f1),0_0_60px_rgb(225_6_0/0.5)]',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
