import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.ts';

const required = { DATABASE_URL: 'postgres://localhost/race_control' };

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      PORT: 4000,
      HOST: '127.0.0.1',
      TRUST_PROXY: 0,
      WEB_URL: 'http://localhost:5173',
      PUBLIC_URL: 'http://localhost:4000',
    });
  });

  it('takes the email settings together, and requires them in production', () => {
    const email = { RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Race Control <login@rc.example>' };
    expect(loadEnv({ ...required, ...email })).toMatchObject(email);
    expect(loadEnv({ ...required, RESEND_API_KEY: ' ', EMAIL_FROM: '' }).RESEND_API_KEY).toBeUndefined();
    expect(() => loadEnv({ ...required, RESEND_API_KEY: 're_test_key' })).toThrow('set both RESEND_API_KEY and EMAIL_FROM');
    expect(() => loadEnv({ ...required, NODE_ENV: 'production' })).toThrow('required in production');
    expect(loadEnv({ ...required, ...email, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });

  it('takes each sign-in provider as a pair', () => {
    expect(loadEnv({ ...required, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' })).toMatchObject({ GITHUB_CLIENT_ID: 'id' });
    expect(() => loadEnv({ ...required, GOOGLE_CLIENT_ID: 'id' })).toThrow('set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  });

  it('takes TRUST_PROXY as a small number of hops', () => {
    expect(loadEnv({ ...required, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(() => loadEnv({ ...required, TRUST_PROXY: 'true' })).toThrow('TRUST_PROXY');
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow('Invalid environment variables: DATABASE_URL');
  });

  it('parses PORT from a string', () => {
    expect(loadEnv({ ...required, PORT: '5050' }).PORT).toBe(5050);
  });

  it('rejects an invalid PORT without echoing its value', () => {
    const env = { ...required, PORT: 'secret-ish-value' };

    expect(() => loadEnv(env)).toThrow('Invalid environment variables: PORT');
    expect(() => loadEnv(env)).not.toThrow(/secret-ish-value/);
  });
});
