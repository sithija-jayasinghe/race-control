import type { Invite, Member, MeResponse, MyTeam, Role } from '@race-control/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { ThemeProvider } from '../src/lib/theme.tsx';
import { routes } from '../src/routes.tsx';

export const TEAM = { id: '11111111-1111-4111-8111-111111111111', name: 'BuildFlow', role: 'lead' as const };
export const USER = { id: '22222222-2222-4222-8222-222222222222', email: 'lead@example.test', name: null };
export const TEAMMATE = { id: '33333333-3333-4333-8333-333333333333', email: 'dev@example.test', name: 'Nimal' };
/** A valid invite token for "Pit Crew", a team the user isn't in yet. */
export const INVITE_TOKEN = 'pit-crew-invite';
export const PIT_CREW = { id: '44444444-4444-4444-8444-444444444444', name: 'Pit Crew' };

type Reply = { status: number; body?: unknown } | 'network-error';
type Handler = (body: unknown, params: string[]) => Reply;

const ok = (body?: unknown): Reply => ({ status: body === undefined ? 204 : 200, body });
const fail = (status: number, error: string): Reply => ({ status, body: { error } });
const JOINED = '2026-10-01T09:00:00.000Z';
let nextId = 0;
const newId = () => `55555555-5555-4555-8555-${String(++nextId).padStart(12, '0')}`;

/**
 * A fake Race Control server behind `fetch`, with the same rules as the real one: sign-in, teams,
 * members (a team always keeps a lead) and invites. Signed out by default. Override any route with `on`.
 */
export function fakeServer(options: { signedIn?: boolean; teams?: MeResponse['teams']; role?: Role } = {}) {
  const myTeams: MyTeam[] = options.teams ?? [{ ...TEAM, role: options.role ?? 'lead' }];
  const state = {
    signedIn: options.signedIn ?? false,
    teams: myTeams,
    members: new Map<string, Member[]>(
      myTeams.map((t) => [
        t.id,
        [
          { userId: USER.id, email: USER.email, name: USER.name, role: t.role, joinedAt: JOINED },
          { userId: TEAMMATE.id, email: TEAMMATE.email, name: TEAMMATE.name, role: t.role === 'lead' ? 'developer' : 'lead', joinedAt: JOINED },
        ],
      ]),
    ),
    invites: new Map<string, Invite[]>(),
  };
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const members = (teamId: string) => state.members.get(teamId) ?? [];
  const isLastLead = (teamId: string, userId: string) => {
    const leads = members(teamId).filter((m) => m.role === 'lead');
    return leads.length === 1 && leads[0]?.userId === userId;
  };
  const inviteFor = (token: unknown) =>
    token === INVITE_TOKEN ? { team: PIT_CREW, role: 'developer' as const, expiresAt: '2026-11-05T09:00:00.000Z' } : null;

  const routes: Array<[string, RegExp, Handler]> = [
    ['GET', /^\/me$/, () => (state.signedIn ? ok({ user: USER, teams: state.teams }) : fail(401, 'unauthorized'))],
    ['POST', /^\/auth\/magic-link$/, () => ({ status: 202, body: { ok: true } })],
    [
      'POST',
      /^\/auth\/verify$/,
      (body) => {
        if ((body as { token?: string }).token !== 'good-token') return fail(400, 'invalid_or_expired_link');
        state.signedIn = true;
        return ok({ user: USER });
      },
    ],
    [
      'POST',
      /^\/auth\/logout$/,
      () => {
        state.signedIn = false;
        return ok();
      },
    ],
    [
      'POST',
      /^\/teams$/,
      (body) => {
        const team = { id: newId(), name: (body as { name: string }).name.trim(), role: 'lead' as const };
        state.teams.push(team);
        state.members.set(team.id, [{ userId: USER.id, email: USER.email, name: null, role: 'lead', joinedAt: JOINED }]);
        return { status: 201, body: team };
      },
    ],
    ['GET', /^\/teams\/([^/]+)\/members$/, (_, [teamId]) => ok(members(teamId!))],
    [
      'PATCH',
      /^\/teams\/([^/]+)\/members\/([^/]+)$/,
      (body, [teamId, userId]) => {
        const role = (body as { role: Role }).role;
        if (role !== 'lead' && isLastLead(teamId!, userId!)) return fail(409, 'last_lead');
        const member = members(teamId!).find((m) => m.userId === userId);
        if (!member) return fail(404, 'not_found');
        member.role = role;
        if (userId === USER.id) state.teams = state.teams.map((t) => (t.id === teamId ? { ...t, role } : t));
        return ok();
      },
    ],
    [
      'DELETE',
      /^\/teams\/([^/]+)\/members\/([^/]+)$/,
      (_, [teamId, userId]) => {
        if (isLastLead(teamId!, userId!)) return fail(409, 'last_lead');
        state.members.set(teamId!, members(teamId!).filter((m) => m.userId !== userId));
        if (userId === USER.id) state.teams = state.teams.filter((t) => t.id !== teamId);
        return ok();
      },
    ],
    ['GET', /^\/teams\/([^/]+)\/invites$/, (_, [teamId]) => ok(state.invites.get(teamId!) ?? [])],
    [
      'POST',
      /^\/teams\/([^/]+)\/invites$/,
      (body, [teamId]) => {
        const invite = {
          id: newId(),
          role: (body as { role: Role }).role,
          createdAt: '2026-10-29T09:00:00.000Z',
          expiresAt: '2026-11-05T09:00:00.000Z',
        };
        state.invites.set(teamId!, [invite, ...(state.invites.get(teamId!) ?? [])]);
        return { status: 201, body: { ...invite, url: `http://web.test/invite#token=new-${invite.id}` } };
      },
    ],
    [
      'DELETE',
      /^\/teams\/([^/]+)\/invites\/([^/]+)$/,
      (_, [teamId, inviteId]) => {
        state.invites.set(teamId!, (state.invites.get(teamId!) ?? []).filter((i) => i.id !== inviteId));
        return ok();
      },
    ],
    [
      'POST',
      /^\/invites\/preview$/,
      (body) => {
        const invite = inviteFor((body as { token?: string }).token);
        if (!invite) return fail(400, 'invalid_or_expired_invite');
        return ok({ teamName: invite.team.name, role: invite.role, expiresAt: invite.expiresAt });
      },
    ],
    [
      'POST',
      /^\/invites\/accept$/,
      (body) => {
        if (!state.signedIn) return fail(401, 'unauthorized');
        const invite = inviteFor((body as { token?: string }).token);
        if (!invite) return fail(400, 'invalid_or_expired_invite');
        const existing = state.teams.find((t) => t.id === invite.team.id);
        const team = existing ?? { ...invite.team, role: invite.role };
        if (!existing) state.teams.push(team);
        return ok(team);
      },
    ],
  ];
  const overrides = new Map<string, Handler>();

  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace(/^\/api/, '');
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });

    let reply: Reply = fail(404, 'not_found');
    const override = overrides.get(`${method} ${path}`);
    if (override) {
      reply = override(body, []);
    } else {
      for (const [m, pattern, handler] of routes) {
        const match = m === method ? pattern.exec(path) : null;
        if (match) {
          reply = handler(body, match.slice(1));
          break;
        }
      }
    }
    if (reply === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }));
  });

  return {
    state,
    calls,
    on: (route: string, handler: Handler) => overrides.set(route, handler),
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
