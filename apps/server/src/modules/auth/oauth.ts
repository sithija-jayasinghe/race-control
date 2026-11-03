import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

// Sign in with GitHub or Google (ADR 0002): the OAuth authorization-code flow with PKCE, talking to the
// providers with plain `fetch`. Only a verified email can create an account or join an existing one.

export const OAUTH_PROVIDERS = ['github', 'google'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export type OAuthClient = { clientId: string; clientSecret: string };
/** The providers this server can sign people in with. `fetch` is swappable for tests. */
export type OAuthConfig = Partial<Record<OAuthProvider, OAuthClient>> & { fetch?: typeof fetch };

/** Who the provider says signed in. `email` is always verified and lower-cased. */
export type OAuthProfile = { providerUserId: string; email: string; name: string | null };

/** Something went wrong talking to the provider. Carries no tokens or codes, so it is safe to log. */
export class OAuthError extends Error {
  override name = 'OAuthError';
}

const PROVIDERS = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
} as const;

const TIMEOUT_MS = 10_000;

export const isOAuthProvider = (name: string): name is OAuthProvider => (OAUTH_PROVIDERS as readonly string[]).includes(name);

/** A random `state` and PKCE verifier for one sign-in attempt. */
export function createOAuthAttempt() {
  return { state: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url') };
}

const challengeFor = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** Where to send the browser to sign in. */
export function authorizeUrl(provider: OAuthProvider, client: OAuthClient, attempt: { state: string; verifier: string; redirectUri: string }) {
  const url = new URL(PROVIDERS[provider].authorizeUrl);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: attempt.redirectUri,
    response_type: 'code',
    scope: PROVIDERS[provider].scope,
    state: attempt.state,
    code_challenge: challengeFor(attempt.verifier),
    code_challenge_method: 'S256',
    ...(provider === 'google' ? { prompt: 'select_account' } : { allow_signup: 'true' }),
  }).toString();
  return url.toString();
}

async function getJson<T>(send: typeof fetch, url: string, init: RequestInit, schema: z.ZodType<T>, what: string): Promise<T> {
  let response: Response;
  try {
    response = await send(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new OAuthError(`${what} request failed (${error instanceof Error ? error.name : 'unknown'})`);
  }
  // Provider error bodies can echo the code or token, so only the status is kept.
  if (!response.ok) throw new OAuthError(`${what} answered ${response.status}`);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new OAuthError(`${what} sent an unexpected answer`);
  return parsed.data;
}

const tokenSchema = z.object({ access_token: z.string().min(1) });
const githubUserSchema = z.object({ id: z.number(), login: z.string(), name: z.string().nullable().optional() });
const githubEmailsSchema = z.array(z.object({ email: z.string(), primary: z.boolean(), verified: z.boolean() }));
const googleUserSchema = z.object({ sub: z.string().min(1), email: z.string().optional(), email_verified: z.boolean().optional(), name: z.string().optional() });

/**
 * Trades the code for an access token, then asks the provider who signed in. Returns null when the
 * provider has no verified email for them.
 */
export async function fetchOAuthProfile(
  provider: OAuthProvider,
  client: OAuthClient,
  callback: { code: string; verifier: string; redirectUri: string },
  send: typeof fetch = fetch,
): Promise<OAuthProfile | null> {
  const { access_token: token } = await getJson(
    send,
    PROVIDERS[provider].tokenUrl,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code: callback.code,
        redirect_uri: callback.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: callback.verifier,
      }).toString(),
    },
    tokenSchema,
    `${provider} token`,
  );
  const auth = { authorization: `Bearer ${token}` };

  if (provider === 'github') {
    const headers = { ...auth, accept: 'application/vnd.github+json', 'user-agent': 'race-control' };
    const user = await getJson(send, 'https://api.github.com/user', { headers }, githubUserSchema, 'github user');
    const emails = await getJson(send, 'https://api.github.com/user/emails', { headers }, githubEmailsSchema, 'github emails');
    const verified = emails.filter((e) => e.verified);
    const email = (verified.find((e) => e.primary) ?? verified[0])?.email;
    if (!email) return null;
    return { providerUserId: String(user.id), email: email.trim().toLowerCase(), name: user.name?.trim() || user.login };
  }

  const user = await getJson(send, 'https://openidconnect.googleapis.com/v1/userinfo', { headers: auth }, googleUserSchema, 'google user');
  if (!user.email || user.email_verified !== true) return null;
  return { providerUserId: user.sub, email: user.email.trim().toLowerCase(), name: user.name?.trim() || null };
}

/** Only paths on this site, so the sign-in flow can't be used to send people elsewhere. */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length > 500 || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  // No control characters, which could split the redirect header.
  return [...next].some((char) => char.charCodeAt(0) < 0x20) ? '/' : next;
}
