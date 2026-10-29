import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const SEEN_KEY = 'rc-lights-seen';
const LIGHT_MS = 550;
const HOLD_MS = 650;
const OUT_MS = 450;
const FADE_MS = 600;

/** Show the start once per browser session, and never when the system asks for reduced motion. */
export function shouldShowLights(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return sessionStorage.getItem(SEEN_KEY) === null;
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Storage blocked: the start may show again on the next load, which is harmless.
  }
}

type Phase = 'counting' | 'out' | 'fading' | 'done';

/** The F1 start: five pairs of red lights come on, go out, and the page launches. Click or press a key to skip. */
export function LightsOut() {
  const [visible] = useState(shouldShowLights);
  const [lit, setLit] = useState(0);
  const [phase, setPhase] = useState<Phase>(visible ? 'counting' : 'done');

  const finish = useCallback(() => {
    markSeen();
    setLit(0);
    setPhase((p) => (p === 'counting' ? 'out' : p));
  }, []);

  // One interval lights the pairs; the last one schedules the lights going out.
  useEffect(() => {
    if (phase !== 'counting') return;
    let count = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      count += 1;
      setLit(count);
      if (count === 5) {
        clearInterval(id);
        hold = setTimeout(finish, HOLD_MS);
      }
    }, LIGHT_MS);
    return () => {
      clearInterval(id);
      clearTimeout(hold);
    };
  }, [phase, finish]);

  // Once out, show "Lights out", then fade, then remove the overlay. Keyed on `launched`, not the
  // phase itself, so moving to 'fading' doesn't cancel the step to 'done'.
  const launched = visible && phase !== 'counting';
  useEffect(() => {
    if (!launched) return;
    const fade = setTimeout(() => setPhase('fading'), OUT_MS);
    const done = setTimeout(() => setPhase('done'), OUT_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [launched]);

  useEffect(() => {
    if (phase !== 'counting') return;
    window.addEventListener('keydown', finish);
    return () => window.removeEventListener('keydown', finish);
  }, [phase, finish]);

  if (phase === 'done') return null;

  return (
    <div
      aria-hidden="true"
      data-testid="lights-out"
      onClick={finish}
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 bg-[#050608] transition-opacity duration-[600ms]',
        phase === 'fading' && 'pointer-events-none opacity-0',
      )}
    >
      <div className="flex gap-4 rounded-xl border border-white/10 bg-[#0d0f13] px-5 py-4 sm:gap-[18px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col gap-2.5 rounded-lg bg-[#08090b] p-2.5">
            {[0, 1].map((j) => (
              <span
                key={j}
                data-lit={i < lit}
                className={cn(
                  'size-7 rounded-full bg-[#1a0b0b] transition-[background,box-shadow] duration-75 sm:size-[34px]',
                  i < lit && 'bg-f1 shadow-[0_0_22px_var(--f1),0_0_60px_rgb(225_6_0/0.5)]',
                )}
              />
            ))}
          </div>
        ))}
      </div>
      <span className={cn('broadcast text-3xl text-[#eceef2] opacity-0 transition-opacity', phase !== 'counting' && 'opacity-100')}>
        Lights out
      </span>
      <span className="font-mono text-[11px] text-[#5a5f69]">click to skip</span>
    </div>
  );
}
