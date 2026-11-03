import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stripApiPrefix } from '../src/lib/api-prefix.ts';
import { createTestApp, signIn, type TestApp } from './helpers/app.ts';
import { SESSION_COOKIE } from '../src/plugins/auth.ts';

describe('stripApiPrefix', () => {
  it('removes a leading /api', () => {
    expect(stripApiPrefix('/api/teams/1/live')).toBe('/teams/1/live');
    expect(stripApiPrefix('/api/auth/github/callback?code=x')).toBe('/auth/github/callback?code=x');
    expect(stripApiPrefix('/api')).toBe('/');
    expect(stripApiPrefix('/api?x=1')).toBe('/?x=1');
  });

  it('leaves every other path alone', () => {
    expect(stripApiPrefix('/hooks/PreToolUse')).toBe('/hooks/PreToolUse');
    expect(stripApiPrefix('/apis')).toBe('/apis');
    expect(stripApiPrefix('/t/abc/api/x')).toBe('/t/abc/api/x');
  });
});

describe('routes under /api', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('answers the same as without the prefix', async () => {
    const health = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const cookie = await signIn(t, 'ana@rc.test');
    const me = await t.app.inject({ method: 'GET', url: '/api/me', cookies: { [SESSION_COOKIE]: cookie } });
    expect(me.statusCode).toBe(200);
  });

  it('keeps unknown paths a 404', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/apis' })).statusCode).toBe(404);
  });
});
