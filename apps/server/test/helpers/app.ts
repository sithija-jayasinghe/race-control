import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { Mailer } from '../../src/lib/mailer.ts';
import { TeamBus } from '../../src/lib/team-bus.ts';
import { SESSION_COOKIE } from '../../src/plugins/auth.ts';
import { createTestDb, type TestDb } from './db.ts';

export const TEST_WEB_URL = 'http://web.test';
export const TEST_PUBLIC_URL = 'http://api.test';

/** A clock that only moves when a test moves it. */
export function createClock(start = new Date('2026-10-28T09:00:00Z')) {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** Collects sent emails instead of sending them. */
export function createMemoryMailer() {
  const sent: Array<{ to: string; url: string }> = [];
  const mailer: Mailer = {
    sendMagicLink(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
  return { mailer, sent };
}

export type TestApp = {
  app: FastifyInstance;
  db: TestDb;
  clock: ReturnType<typeof createClock>;
  bus: TeamBus;
  sent: Array<{ to: string; url: string }>;
  close: () => Promise<void>;
};

export async function createTestApp(options: { cookieSecure?: boolean } = {}): Promise<TestApp> {
  const { db, close: closeDb } = await createTestDb();
  const clock = createClock();
  const { mailer, sent } = createMemoryMailer();
  const bus = new TeamBus();
  const app = await buildApp({
    db,
    bus,
    mailer,
    webUrl: TEST_WEB_URL,
    publicUrl: TEST_PUBLIC_URL,
    cookieSecure: options.cookieSecure ?? false,
    now: clock.now,
    logger: false,
  });
  return {
    app,
    db,
    clock,
    bus,
    sent,
    close: async () => {
      await app.close();
      await closeDb();
    },
  };
}

/** The token from the magic link most recently sent to `email`. */
export function lastMagicLinkToken(sent: TestApp['sent'], email: string): string {
  const message = sent.findLast((m) => m.to === email);
  if (!message) throw new Error(`no magic link sent to ${email}`);
  const token = new URLSearchParams(new URL(message.url).hash.slice(1)).get('token');
  if (!token) throw new Error('magic link has no token');
  return token;
}

export function sessionCookie(response: LightMyRequestResponse): string | undefined {
  return response.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
}

/** Signs in through the real magic-link flow and returns the login cookie value. */
export async function signIn(t: TestApp, email: string): Promise<string> {
  await t.app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email } });
  const response = await t.app.inject({
    method: 'POST',
    url: '/auth/verify',
    payload: { token: lastMagicLinkToken(t.sent, email) },
  });
  const cookie = sessionCookie(response);
  if (response.statusCode !== 200 || !cookie) throw new Error(`sign-in failed: ${response.body}`);
  return cookie;
}

export type SignedInUser = {
  id: string;
  email: string;
  cookie: string;
  /** Sends a request as this user. */
  request: (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => Promise<LightMyRequestResponse>;
};

/** Signs in and returns a client that sends requests with the login cookie. */
export async function signInAs(t: TestApp, email: string): Promise<SignedInUser> {
  const cookie = await signIn(t, email);
  const request: SignedInUser['request'] = (method, url, payload) =>
    t.app.inject({ method, url, payload, cookies: { [SESSION_COOKIE]: cookie } });
  const me = await request('GET', '/me');
  const { user } = me.json<{ user: { id: string } }>();
  return { id: user.id, email, cookie, request };
}

/** Creates a team through the API and returns its id. */
export async function createTeamAs(user: SignedInUser, name: string): Promise<string> {
  const response = await user.request('POST', '/teams', { name });
  if (response.statusCode !== 201) throw new Error(`create team failed: ${response.body}`);
  return response.json<{ id: string }>().id;
}

/** The token in an invite URL. */
export function inviteToken(url: string): string {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  if (!token) throw new Error('invite URL has no token');
  return token;
}

/** Has `lead` invite `member` to the team with the given role, and accepts it. */
export async function addMember(lead: SignedInUser, teamId: string, member: SignedInUser, role: 'lead' | 'developer') {
  const created = await lead.request('POST', `/teams/${teamId}/invites`, { role });
  const token = inviteToken(created.json<{ url: string }>().url);
  const accepted = await member.request('POST', '/invites/accept', { token });
  if (accepted.statusCode !== 200) throw new Error(`accept failed: ${accepted.body}`);
}
