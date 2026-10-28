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
      WEB_URL: 'http://localhost:5173',
    });
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
