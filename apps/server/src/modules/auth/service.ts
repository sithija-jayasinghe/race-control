import type { User } from '@race-control/shared';
import type { AppDeps } from '../../app.ts';
import { createSecureToken, hashToken } from '../../lib/secure-token.ts';
import { SESSION_TTL_MS } from '../../plugins/auth.ts';
import type { DbOrTx } from '../../db/client.ts';
import { fetchOAuthProfile, type OAuthProvider } from './oauth.ts';
import * as repo from './repo.ts';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Links sent to one address per MAGIC_LINK_TTL_MS. Extra requests are silently dropped. */
export const MAX_MAGIC_LINKS_PER_EMAIL = 3;

type Deps = Pick<AppDeps, 'db' | 'mailer' | 'webUrl' | 'now'>;

/** A 30-day login session. Returns the cookie value; only its hash is stored. */
async function startSession(db: DbOrTx, userId: string, now: Date): Promise<string> {
  const sessionToken = createSecureToken();
  await repo.insertAuthSession(db, { userId, tokenHash: hashToken(sessionToken), expiresAt: new Date(now.getTime() + SESSION_TTL_MS), now });
  return sessionToken;
}

/**
 * Emails a single-use login link. Behaves the same whether or not the email has an account,
 * so the response can't be used to find out who is registered.
 */
export async function requestMagicLink(deps: Deps, email: string): Promise<void> {
  const now = deps.now();
  const since = new Date(now.getTime() - MAGIC_LINK_TTL_MS);
  if ((await repo.countRecentLoginTokens(deps.db, email, since)) >= MAX_MAGIC_LINKS_PER_EMAIL) {
    return;
  }

  const token = createSecureToken();
  await repo.insertLoginToken(deps.db, {
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + MAGIC_LINK_TTL_MS),
    createdAt: now,
  });

  // The token goes in the URL fragment, which browsers never send to servers or in referrers.
  const url = new URL('/auth/verify', deps.webUrl);
  url.hash = new URLSearchParams({ token }).toString();
  await deps.mailer.sendMagicLink({ to: email, url: url.toString() });
}

/** Uses up a magic link and starts a 30-day login session. Returns null if the link is invalid. */
export async function verifyMagicLink(
  deps: Pick<Deps, 'db' | 'now'>,
  token: string,
): Promise<{ user: User; sessionToken: string } | null> {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const email = await repo.consumeLoginToken(tx, hashToken(token), now);
    if (!email) return null;

    const user = await repo.findOrCreateEmailUser(tx, email);
    return { user, sessionToken: await startSession(tx, user.id, now) };
  });
}

/**
 * Finishes GitHub or Google sign-in: asks the provider who it is, then signs in to their account (see
 * `findOrCreateProviderUser`). Without a verified email nobody is signed in.
 */
export async function signInWithProvider(
  deps: Pick<AppDeps, 'db' | 'now' | 'oauth'>,
  provider: OAuthProvider,
  callback: { code: string; verifier: string; redirectUri: string },
): Promise<{ user: User; sessionToken: string } | 'no_verified_email'> {
  const client = deps.oauth[provider];
  if (!client) throw new Error(`${provider} sign-in is not configured`);
  const profile = await fetchOAuthProfile(provider, client, callback, deps.oauth.fetch);
  if (!profile) return 'no_verified_email';
  return deps.db.transaction(async (tx) => {
    const user = await repo.findOrCreateProviderUser(tx, { provider, ...profile });
    return { user, sessionToken: await startSession(tx, user.id, deps.now()) };
  });
}
