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

/** A WebSocket stand-in: tests open it, push messages and close it by hand. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** The most recent socket that's still open. */
  static latest(): FakeWebSocket {
    const socket = [...FakeWebSocket.instances].reverse().find((s) => !s.closed);
    if (!socket) throw new Error('no open FakeWebSocket');
    return socket;
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket);
afterEach(() => {
  FakeWebSocket.instances = [];
});
