import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.ts';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({})).toEqual({ NODE_ENV: 'development', PORT: 4000, HOST: '127.0.0.1' });
  });

  it('parses PORT from a string', () => {
    expect(loadEnv({ PORT: '5050' }).PORT).toBe(5050);
  });

  it('rejects an invalid PORT without echoing its value', () => {
    expect(() => loadEnv({ PORT: 'secret-ish-value' })).toThrow('Invalid environment variables: PORT');
    expect(() => loadEnv({ PORT: 'secret-ish-value' })).not.toThrow(/secret-ish-value/);
  });
});
