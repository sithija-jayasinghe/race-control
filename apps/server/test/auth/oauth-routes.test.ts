import { eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.ts';
import { OAUTH_COOKIE } from '../../src/modules/auth/routes.ts';
import { SESSION_COOKIE } from '../../src/plugins/auth.ts';
import { createTestApp, signIn, TEST_WEB_URL, type TestApp } from '../helpers/app.ts';
import { fakeProviders, type FakeAccounts } from '../helpers/oauth.ts';

const CLIENT = { clientId: 'client-id', clientSecret: 'client-secret' };
let t: TestApp;

async function appWith(accounts: FakeAccounts, providers: Array<'github' | 'google'> = ['github', 'google'], logLines?: string[]) {
  const fake = fakeProviders(accounts);
  t = await createTestApp({ oauth: { ...Object.fromEntries(providers.map((p) => [p, CLIENT])), fetch: fake.fetch }, logLines });
  return fake;
}

afterEach(async () => {
  await t.close();
});

const cookie = (response: LightMyRequestResponse, name: string) => response.cookies.find((c) => c.name === name);

/** Starts sign-in, then comes back from the provider with the state it was given. */
async function signInWith(provider: 'github' | 'google', options: { next?: string; state?: string; query?: string } = {}) {
  const start = await t.app.inject({ method: 'GET', url: `/auth/${provider}/start${options.next ? `?next=${encodeURIComponent(options.next)}` : ''}` });
  const state = new URL(start.headers.location!).searchParams.get('state')!;
  const attempt = cookie(start, OAUTH_COOKIE)!.value;
  return t.app.inject({
    method: 'GET',
    url: `/auth/${provider}/callback?${options.query ?? `code=the-code&state=${options.state ?? state}`}`,
    cookies: { [OAUTH_COOKIE]: attempt },
  });
}

const me = (response: LightMyRequestResponse) =>
  t.app.inject({ method: 'GET', url: '/me', cookies: { [SESSION_COOKIE]: cookie(response, SESSION_COOKIE)!.value } });

const github = { id: 42, login: 'amaya', name: 'Amaya', emails: [{ email: 'amaya@example.test', primary: true, verified: true }] };

describe('GET /auth/providers', () => {
  it('lists only the sign-in methods this server has set up', async () => {
    await appWith({}, ['google']);

    expect((await t.app.inject({ method: 'GET', url: '/auth/providers' })).json()).toEqual({ providers: ['google'] });
    expect((await t.app.inject({ method: 'GET', url: '/auth/github/start' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/auth/twitter/start' })).statusCode).toBe(404);
  });
});

describe('GET /auth/:provider/start', () => {
  it('sends the browser to the provider, back through the web app, with a short-lived attempt cookie', async () => {
    await appWith({});

    const response = await t.app.inject({ method: 'GET', url: '/auth/github/start?next=/t/abc' });

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('redirect_uri')).toBe(`${TEST_WEB_URL}/api/auth/github/callback`);
    expect(cookie(response, OAUTH_COOKIE)).toMatchObject({ httpOnly: true, sameSite: 'Lax', maxAge: 600, path: '/' });
  });
});

describe('GET /auth/:provider/callback', () => {
  it('creates an account from a verified email and returns to where the person was going', async () => {
    await appWith({ github });

    const response = await signInWith('github', { next: '/t/abc/approvals' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${TEST_WEB_URL}/t/abc/approvals`);
    expect(cookie(response, OAUTH_COOKIE)?.value).toBe('');
    expect((await me(response)).json()).toMatchObject({ user: { email: 'amaya@example.test', name: 'Amaya' } });
    const [identity] = await t.db.select().from(schema.authIdentities).where(eq(schema.authIdentities.provider, 'github'));
    expect(identity).toMatchObject({ providerUserId: '42', email: 'amaya@example.test' });
  });

  it('joins the account that already has that verified email', async () => {
    await appWith({ google: { sub: 'g-1', email: 'Kasun@Example.test', email_verified: true, name: 'Kasun' } });
    await signIn(t, 'kasun@example.test');

    const response = await signInWith('google');

    expect((await me(response)).json<{ user: { name: string | null } }>().user).toMatchObject({ email: 'kasun@example.test' });
    expect(await t.db.$count(schema.users)).toBe(1);
  });

  it('keeps signing in to the same account after the provider email changes', async () => {
    const fake = { github: { ...github } };
    await appWith(fake);
    const first = await me(await signInWith('github'));
    fake.github.emails = [{ email: 'amaya@new.test', primary: true, verified: true }];

    const second = await me(await signInWith('github'));

    expect(second.json<{ user: { id: string } }>().user.id).toBe(first.json<{ user: { id: string } }>().user.id);
  });

  it('signs nobody in without a verified email', async () => {
    await appWith({ github: { ...github, emails: [{ email: 'amaya@example.test', primary: true, verified: false }] } });
    await signIn(t, 'amaya@example.test');

    const response = await signInWith('github');

    expect(response.headers.location).toBe(`${TEST_WEB_URL}/sign-in?error=no_verified_email&provider=github`);
    expect(cookie(response, SESSION_COOKIE)).toBeUndefined();
    expect(await t.db.$count(schema.authIdentities, eq(schema.authIdentities.provider, 'github'))).toBe(0);
  });

  it('refuses a tampered or missing attempt, and says when the person said no', async () => {
    await appWith({ github });

    expect((await signInWith('github', { state: 'not-the-state' })).headers.location).toContain('error=expired');
    expect((await t.app.inject({ method: 'GET', url: '/auth/github/callback?code=c&state=s' })).headers.location).toContain('error=expired');
    expect((await signInWith('github', { query: 'error=access_denied' })).headers.location).toContain('error=cancelled');
    expect(await t.db.$count(schema.users)).toBe(0);
  });

  it("refuses an attempt started for the other provider", async () => {
    await appWith({ github, google: { sub: 'g', email: 'a@example.test', email_verified: true } });
    const start = await t.app.inject({ method: 'GET', url: '/auth/google/start' });
    const state = new URL(start.headers.location!).searchParams.get('state')!;

    const response = await t.app.inject({
      method: 'GET',
      url: `/auth/github/callback?code=c&state=${state}`,
      cookies: { [OAUTH_COOKIE]: cookie(start, OAUTH_COOKIE)!.value },
    });

    expect(response.headers.location).toContain('error=expired');
  });

  it('says so when the provider fails', async () => {
    await appWith({ github: { ...github, tokenStatus: 500 } });

    expect((await signInWith('github')).headers.location).toBe(`${TEST_WEB_URL}/sign-in?error=failed&provider=github`);
  });

  it('never sends people off the site afterwards', async () => {
    await appWith({ github });

    expect((await signInWith('github', { next: '//evil.test/x' })).headers.location).toBe(`${TEST_WEB_URL}/`);
  });

  it('never logs the one-time code or state', async () => {
    const lines: string[] = [];
    await appWith({ github }, ['github'], lines);

    await signInWith('github');

    const logs = lines.join('\n');
    expect(logs).toContain('/auth/github/callback');
    expect(logs).not.toMatch(/the-code|state=/);
  });
});
