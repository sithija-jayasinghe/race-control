import type { MeResponse } from '@race-control/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { routes } from '../src/routes.tsx';

export const TEAM = { id: '11111111-1111-4111-8111-111111111111', name: 'BuildFlow', role: 'lead' as const };
export const USER = { id: '22222222-2222-4222-8222-222222222222', email: 'lead@example.test', name: null };

type Reply = { status: number; body?: unknown } | 'network-error';
type Handler = (body: unknown) => Reply;

/**
 * A fake Race Control server behind `fetch`. Signed out by default; `/auth/verify` signs in and
 * `/auth/logout` signs out, like the real one. Override any route with `on`.
 */
export function fakeServer(options: { signedIn?: boolean; teams?: MeResponse['teams'] } = {}) {
  const state = { signedIn: options.signedIn ?? false, teams: options.teams ?? [TEAM] };
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const handlers = new Map<string, Handler>([
    ['GET /me', () => (state.signedIn ? { status: 200, body: { user: USER, teams: state.teams } } : { status: 401, body: { error: 'unauthorized' } })],
    ['POST /auth/magic-link', () => ({ status: 202, body: { ok: true } })],
    [
      'POST /auth/verify',
      (body) => {
        if ((body as { token?: string }).token !== 'good-token') return { status: 400, body: { error: 'invalid_or_expired_link' } };
        state.signedIn = true;
        return { status: 200, body: { user: USER } };
      },
    ],
    [
      'POST /auth/logout',
      () => {
        state.signedIn = false;
        return { status: 204 };
      },
    ],
  ]);

  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const handler = handlers.get(`${method} ${path}`);
    const reply = handler ? handler(body) : { status: 404, body: { error: 'not_found' } };
    if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }));
  });

  return {
    state,
    calls,
    on: (route: string, handler: Handler) => handlers.set(route, handler),
    callsTo: (route: string) => calls.filter((c) => `${c.method} ${c.path}` === route),
  };
}

/** Renders the whole app at `path`, in StrictMode like `main.tsx`. */
export function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  return { ...view, router };
}
