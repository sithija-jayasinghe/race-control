import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { hashToken } from '../../src/lib/secure-token.ts';
import { MAGIC_LINK_TTL_MS } from '../../src/modules/auth/service.ts';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../../src/plugins/auth.ts';
import {
  TEST_WEB_URL,
  createTestApp,
  lastMagicLinkToken,
  sessionCookie,
  signIn,
  type TestApp,
} from '../helpers/app.ts';
import { seedTeam } from '../helpers/db.ts';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

afterEach(async () => {
  await t.close();
});

const requestLink = (email: string) =>
  t.app.inject({ method: 'POST', url: '/auth/magic-link', payload: { email } });
const verify = (token: string) => t.app.inject({ method: 'POST', url: '/auth/verify', payload: { token } });
const me = (cookie?: string) =>
  t.app.inject({ method: 'GET', url: '/me', cookies: cookie ? { [SESSION_COOKIE]: cookie } : {} });

describe('POST /auth/magic-link', () => {
  it('emails a link to the dashboard with the token in the URL fragment', async () => {
    const response = await requestLink('dev@example.test');

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.to).toBe('dev@example.test');
    expect(t.sent[0]?.url).toMatch(new RegExp(`^${TEST_WEB_URL}/auth/verify#token=[\\w-]{43}$`));
  });

  it('normalises the email', async () => {
    await requestLink('  Dev@Example.TEST ');

    expect(t.sent[0]?.to).toBe('dev@example.test');
  });

  it('answers the same for registered and unknown emails', async () => {
    await signIn(t, 'known@example.test');

    const known = await requestLink('known@example.test');
    const unknown = await requestLink('unknown@example.test');

    expect([known.statusCode, known.body]).toEqual([unknown.statusCode, unknown.body]);
  });

  it('stores only a hash of the token', async () => {
    await requestLink('dev@example.test');
    const token = lastMagicLinkToken(t.sent, 'dev@example.test');

    const rows = await t.db.select().from(schema.loginTokens);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('rejects an invalid email without sending anything', async () => {
    const response = await requestLink('not-an-email');

    expect(response.statusCode).toBe(400);
    expect(t.sent).toHaveLength(0);
  });

  it('sends at most 3 links per address per 15 minutes', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await requestLink('dev@example.test')).statusCode).toBe(202);
    }
    expect(t.sent).toHaveLength(3);

    t.clock.advance(MAGIC_LINK_TTL_MS + 1);
    await requestLink('dev@example.test');

    expect(t.sent).toHaveLength(4);
  });

  it('rate-limits requests from one address', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await requestLink(`dev${i}@example.test`)).statusCode);
    }

    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });
});

describe('POST /auth/verify', () => {
  it('creates the user on first sign-in and sets a 30-day login cookie', async () => {
    await requestLink('new@example.test');

    const response = await verify(lastMagicLinkToken(t.sent, 'new@example.test'));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: expect.any(String) as string, email: 'new@example.test', name: null },
    });
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_MS / 1000 });
    expect(cookie?.secure).toBeUndefined();

    const identities = await t.db.select().from(schema.authIdentities);
    expect(identities).toMatchObject([{ provider: 'email', providerUserId: 'new@example.test' }]);
  });

  it('marks the cookie Secure when configured', async () => {
    await t.close();
    t = await createTestApp({ cookieSecure: true });
    await requestLink('dev@example.test');

    const response = await verify(lastMagicLinkToken(t.sent, 'dev@example.test'));

    expect(response.cookies.find((c) => c.name === SESSION_COOKIE)?.secure).toBe(true);
  });

  it('stores only a hash of the login cookie', async () => {
    const cookie = await signIn(t, 'dev@example.test');

    const [session] = await t.db.select().from(schema.authSessions);

    expect(session?.tokenHash).toBe(hashToken(cookie));
  });

  it('accepts a link only once', async () => {
    await requestLink('dev@example.test');
    const token = lastMagicLinkToken(t.sent, 'dev@example.test');

    expect((await verify(token)).statusCode).toBe(200);
    const second = await verify(token);

    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual({ error: 'invalid_or_expired_link' });
    expect(sessionCookie(second)).toBeUndefined();
  });

  it('rejects a link after 15 minutes', async () => {
    await requestLink('dev@example.test');
    t.clock.advance(MAGIC_LINK_TTL_MS + 1);

    const response = await verify(lastMagicLinkToken(t.sent, 'dev@example.test'));

    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown token', async () => {
    expect((await verify('made-up-token')).statusCode).toBe(400);
  });

  it('signs an existing user back in to the same account', async () => {
    await t.db.insert(schema.users).values({ email: 'Lead@Example.test', name: 'Lead' });

    await signIn(t, 'lead@example.test');
    await signIn(t, 'lead@example.test');

    expect(await t.db.$count(schema.users)).toBe(1);
    expect(await t.db.$count(schema.authIdentities)).toBe(1);
    expect(await t.db.$count(schema.authSessions)).toBe(2);
  });
});

describe('GET /me', () => {
  it('requires a login cookie', async () => {
    expect((await me()).statusCode).toBe(401);
    expect((await me('not-a-real-session')).statusCode).toBe(401);
  });

  it('returns the user and only their own teams', async () => {
    const cookie = await signIn(t, 'dev@example.test');
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.email, 'dev@example.test'));
    const alpha = await seedTeam(t.db, 'Alpha');
    await seedTeam(t.db, 'Beta');
    await t.db.insert(schema.memberships).values({ teamId: alpha.team.id, userId: user!.id, role: 'developer' });

    const response = await me(cookie);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: user!.id, email: 'dev@example.test', name: null },
      teams: [{ id: alpha.team.id, name: 'Alpha', role: 'developer' }],
    });
  });

  it('expires the login after 30 days', async () => {
    const cookie = await signIn(t, 'dev@example.test');

    t.clock.advance(SESSION_TTL_MS - 1000);
    expect((await me(cookie)).statusCode).toBe(200);
    t.clock.advance(1000);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('records when the login was last used, at most hourly', async () => {
    const cookie = await signIn(t, 'dev@example.test');
    const lastSeen = async () => (await t.db.select().from(schema.authSessions))[0]?.lastSeenAt.getTime();
    const signedInAt = await lastSeen();

    t.clock.advance(30 * 60 * 1000);
    await me(cookie);
    expect(await lastSeen()).toBe(signedInAt);

    t.clock.advance(31 * 60 * 1000);
    await me(cookie);
    expect(await lastSeen()).toBe(t.clock.now().getTime());
  });
});

describe('POST /auth/logout', () => {
  it('ends the login session and clears the cookie', async () => {
    const cookie = await signIn(t, 'dev@example.test');

    const response = await t.app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [SESSION_COOKIE]: cookie },
    });

    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe('');
    expect(await t.db.$count(schema.authSessions)).toBe(0);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('succeeds without a login', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/auth/logout' })).statusCode).toBe(204);
  });
});
