import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = '';
  media.prefersDark = false;
  media.reducedMotion = false;
});

/** jsdom has no matchMedia. Tests flip these to simulate the OS settings. */
export const media = { prefersDark: false, reducedMotion: false };
const listeners = new Set<() => void>();

vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    if (query.includes('reduced-motion')) return media.reducedMotion;
    return query.includes('dark') && media.prefersDark;
  },
  media: query,
  addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
}));

// jsdom can't draw on a canvas; the track scene skips drawing when there is no context.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

export function setSystemDark(dark: boolean) {
  media.prefersDark = dark;
  for (const listener of listeners) listener();
}
