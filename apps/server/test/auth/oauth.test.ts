import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorizeUrl, createOAuthAttempt, fetchOAuthProfile, OAuthError, safeNext } from '../../src/modules/auth/oauth.ts';
import { fakeProviders } from '../helpers/oauth.ts';

const client = { clientId: 'client-id', clientSecret: 'client-secret' };
const redirectUri = 'https://rc.example/api/auth/github/callback';

describe('authorizeUrl', () => {
  it('sends state and a PKCE challenge, never the verifier', () => {
    const attempt = createOAuthAttempt();
    const url = new URL(authorizeUrl('github', client, { ...attempt, redirectUri }));

    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-id',
      redirect_uri: redirectUri,
      state: attempt.state,
      code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
      code_challenge_method: 'S256',
      scope: 'read:user user:email',
    });
    expect(url.toString()).not.toContain(attempt.verifier);
  });
});

describe('fetchOAuthProfile', () => {
  const callback = { code: 'the-code', verifier: 'the-verifier', redirectUri };

  it("uses GitHub's primary verified email", async () => {
    const providers = fakeProviders({
      github: { id: 42, login: 'amaya', name: 'Amaya', emails: [{ email: 'old@x.test', primary: false, verified: true }, { email: 'Amaya@X.test', primary: true, verified: true }] },
    });

    expect(await fetchOAuthProfile('github', client, callback, providers.fetch)).toEqual({ providerUserId: '42', email: 'amaya@x.test', name: 'Amaya' });
    expect(providers.tokenRequests[0]).toMatchObject({ code: 'the-code', code_verifier: 'the-verifier', client_secret: 'client-secret' });
  });

  it('gives nothing without a verified email', async () => {
    const github = fakeProviders({ github: { id: 1, login: 'x', emails: [{ email: 'x@x.test', primary: true, verified: false }] } });
    const google = fakeProviders({ google: { sub: 'g1', email: 'x@x.test', email_verified: false } });

    expect(await fetchOAuthProfile('github', client, callback, github.fetch)).toBeNull();
    expect(await fetchOAuthProfile('google', client, callback, google.fetch)).toBeNull();
  });

  it("uses Google's verified email", async () => {
    const providers = fakeProviders({ google: { sub: 'g-123', email: 'Kasun@Example.test', email_verified: true, name: 'Kasun' } });

    expect(await fetchOAuthProfile('google', client, callback, providers.fetch)).toEqual({ providerUserId: 'g-123', email: 'kasun@example.test', name: 'Kasun' });
  });

  it('fails without putting the code or token in the error', async () => {
    const providers = fakeProviders({ github: { tokenStatus: 401 } });

    const error = await fetchOAuthProfile('github', client, callback, providers.fetch).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OAuthError);
    expect((error as Error).message).toBe('github token answered 401');
  });
});

describe('safeNext', () => {
  it('keeps paths on this site and drops anything else', () => {
    expect(safeNext('/t/123/approvals?x=1')).toBe('/t/123/approvals?x=1');
    for (const bad of [undefined, '', 'https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/a\nb', `/${'a'.repeat(600)}`]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});
