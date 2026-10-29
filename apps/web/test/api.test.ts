import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, api } from '../src/lib/api.ts';

const reply = (status: number, body?: unknown) =>
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }))));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('calls /api with the login cookie and a JSON body', async () => {
    reply(200, { ok: true });

    await api('/auth/magic-link', { method: 'POST', body: { email: 'a@b.test' } });

    expect(fetch).toHaveBeenCalledWith('/api/auth/magic-link', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{"email":"a@b.test"}',
    });
  });

  it('turns error answers into ApiError with the server’s code', async () => {
    reply(400, { error: 'invalid_or_expired_link' });

    await expect(api('/auth/verify')).rejects.toMatchObject({ status: 400, code: 'invalid_or_expired_link' });
  });

  it('handles empty answers', async () => {
    reply(204);

    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeNull();
  });

  it('reports network failures as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    const error = await api('/me').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('rejects answers that don’t match the expected shape', async () => {
    reply(200, { user: { id: 'not-a-uuid' } });

    await expect(api('/me', { schema: z.object({ user: z.object({ id: z.uuid() }) }) })).rejects.toThrow();
  });
});
