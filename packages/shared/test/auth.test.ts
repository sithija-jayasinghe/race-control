import { describe, expect, it } from 'vitest';
import { magicLinkRequestSchema } from '../src/index.ts';

describe('magicLinkRequestSchema', () => {
  it('trims and lower-cases the email', () => {
    expect(magicLinkRequestSchema.parse({ email: '  Dev@Example.TEST ' })).toEqual({ email: 'dev@example.test' });
  });

  it.each(['', 'not-an-email', 'a@', `${'a'.repeat(250)}@x.io`])('rejects %j', (email) => {
    expect(magicLinkRequestSchema.safeParse({ email }).success).toBe(false);
  });
});
