import type { User } from '@race-control/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findSessionByTokenHash, touchSession } from '../modules/auth/repo.ts';
import type { AppDeps } from '../app.ts';
import { hashToken } from '../lib/secure-token.ts';

export const SESSION_COOKIE = 'rc_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in dashboard user, or null. Set from the `rc_session` cookie. */
    user: User | null;
    authSessionId: string | null;
  }
}

/** Reads the login cookie on every request. Register after @fastify/cookie. */
export function registerAuth(app: FastifyInstance, deps: Pick<AppDeps, 'db' | 'now'>) {
  app.decorateRequest('user', null);
  app.decorateRequest('authSessionId', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;

    const now = deps.now();
    const found = await findSessionByTokenHash(deps.db, hashToken(token), now);
    if (!found) return;

    request.user = found.user;
    request.authSessionId = found.sessionId;
    if (now.getTime() - found.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await touchSession(deps.db, found.sessionId, now);
    }
  });
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}
