import type { ReactNode } from 'react';
import { TrackScene } from '@/components/track-scene';
import { Wordmark } from '@/components/wordmark';

/** Pages outside the app shell (sign-in, invites): the track scene, the wordmark, and one centred column. */
export function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <TrackScene />
      <header className="p-4 sm:p-6">
        <Wordmark />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
