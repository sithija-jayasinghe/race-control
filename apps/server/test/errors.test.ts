import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Database } from '../src/db/client.ts';
import { safeErrorForLog } from '../src/lib/errors.ts';
import { createClock, createMemoryMailer } from './helpers/app.ts';

const SECRET_EMAIL = 'private.person@example.test';

/** A database whose every query fails the way Drizzle does: with the SQL and params in the message. */
function failingDb(): Database {
  const fail = () => {
    const cause = Object.assign(new Error('Key (email)=(private.person@example.test) already exists.'), {
      code: '23505',
      constraint: 'users_email_lower_key',
    });
    throw new Error(`Failed query: select ... where email = $1\nparams: ${SECRET_EMAIL}`, { cause });
  };
  return new Proxy({} as Database, { get: () => fail });
}

describe('error handling', () => {
  const logs: string[] = [];
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    logs.length = 0;
    app = await buildApp({
      db: failingDb(),
      mailer: createMemoryMailer().mailer,
      webUrl: 'http://web.test',
      cookieSecure: false,
      now: createClock().now,
      logger: { level: 'error', stream: { write: (line: string) => logs.push(line) } },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('hides database errors from the client and from the logs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: SECRET_EMAIL },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
    expect(logs.join('')).toContain('request failed');
    expect(logs.join('')).toContain('23505');
    expect(logs.join('')).not.toContain('private.person');
    expect(logs.join('')).not.toContain('Failed query');
  });

  it('reports validation errors without echoing the input', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: 'secret-value-not-an-email' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_request', issues: [{ path: '/email' }] });
    expect(response.body).not.toContain('secret-value');
  });
});

describe('safeErrorForLog', () => {
  it('keeps names and codes, drops messages, even multi-line ones', () => {
    const error = new Error('Failed query\nparams: secret', {
      cause: Object.assign(new Error('detail: secret'), { code: '23505' }),
    });

    const safe = safeErrorForLog(error);

    expect(safe.chain).toEqual([
      { name: 'Error', code: undefined, constraint: undefined, table: undefined },
      { name: 'Error', code: '23505', constraint: undefined, table: undefined },
    ]);
    expect(JSON.stringify(safe)).not.toContain('secret');
    expect(safe.stack).toMatch(/^\s+at /);
  });
});
