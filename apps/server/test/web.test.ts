import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeUrl } from '../src/plugins/web.ts';
import { createTestApp, type TestApp } from './helpers/app.ts';

describe('routeUrl', () => {
  it('sends the API, hooks and health check to the server, and everything else to the web app', () => {
    expect(routeUrl('/api/teams?x=1', true)).toBe('/teams?x=1');
    expect(routeUrl('/hooks/PreToolUse', true)).toBe('/hooks/PreToolUse');
    expect(routeUrl('/health', true)).toBe('/health');
    expect(routeUrl('/teams', true)).toBe('/_web/teams');
    expect(routeUrl('/auth/verify', true)).toBe('/_web/auth/verify');
    expect(routeUrl('/', true)).toBe('/_web/');
  });

  it('leaves the API unprefixed when not serving the web app', () => {
    expect(routeUrl('/teams', false)).toBe('/teams');
    expect(routeUrl('/api/teams', false)).toBe('/teams');
  });
});

describe('serving the web app', () => {
  let t: TestApp;
  let dist: string;
  const INDEX = '<!doctype html><title>Race Control</title>';

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'rc-web-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), INDEX);
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    writeFileSync(join(dist, 'favicon.svg'), '<svg/>');
    t = await createTestApp({ webDist: dist });
  });

  afterAll(async () => {
    await t.close();
    rmSync(dist, { recursive: true, force: true });
  });

  const get = (url: string) => t.app.inject({ method: 'GET', url });

  it.each(['/', '/sign-in', '/auth/verify', '/t/abc/approvals/xyz', '/teams', '/me'])('serves index.html for %s', async (url) => {
    const response = await get(url);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(INDEX);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('caches built files for good, and other files only until they change', async () => {
    const script = await get('/assets/index-abc123.js');
    expect(script.statusCode).toBe(200);
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const icon = await get('/favicon.svg');
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it("answers 404 for a missing file instead of the app", async () => {
    expect((await get('/assets/index-old.js')).statusCode).toBe(404);
    expect((await get('/robots.txt')).statusCode).toBe(404);
  });

  it('answers 404 for anything but GET outside the API', async () => {
    expect((await t.app.inject({ method: 'POST', url: '/sign-in' })).statusCode).toBe(404);
  });

  it('stops other sites framing the dashboard', async () => {
    const response = await get('/t/abc/approvals/xyz');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps the API under /api, and hooks and the health check where agents expect them', async () => {
    expect((await get('/api/me')).statusCode).toBe(401);
    expect((await get('/health')).json()).toEqual({ status: 'ok' });
    const hook = await t.app.inject({ method: 'POST', url: '/hooks/PreToolUse', payload: {} });
    expect(hook.statusCode).toBe(401);
  });
});
