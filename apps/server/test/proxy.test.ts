import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app.ts';

// Behind a proxy (Render), every request arrives from the proxy's address. Rate limits must still
// count each person separately, without letting a client choose its own address.

const signInFrom = (t: TestApp, forwardedFor: string) =>
  t.app.inject({
    method: 'POST',
    url: '/auth/magic-link',
    payload: { email: 'ana@rc.test' },
    headers: { 'x-forwarded-for': forwardedFor },
  });

async function signInFiveTimes(t: TestApp, forwardedFor: string) {
  for (let i = 0; i < 5; i++) expect((await signInFrom(t, forwardedFor)).statusCode).toBe(202);
}

describe('trusting a proxy', () => {
  let t: TestApp;

  afterEach(async () => {
    await t.close();
  });

  it('limits each client separately when the proxy is trusted', async () => {
    t = await createTestApp({ trustProxy: 1 });
    await signInFiveTimes(t, '203.0.113.1');

    expect((await signInFrom(t, '203.0.113.1')).statusCode).toBe(429);
    expect((await signInFrom(t, '203.0.113.2')).statusCode).toBe(202);
  });

  it('uses the address the proxy saw, not one the client wrote in front of it', async () => {
    t = await createTestApp({ trustProxy: 1 });
    await signInFiveTimes(t, '203.0.113.1');

    expect((await signInFrom(t, '198.51.100.9, 203.0.113.1')).statusCode).toBe(429);
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    t = await createTestApp();
    await signInFiveTimes(t, '203.0.113.1');

    expect((await signInFrom(t, '203.0.113.2')).statusCode).toBe(429);
  });
});
