import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.ts';
import { verifyDevToken, type DevTokenAuth } from '../modules/tokens/service.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireDevToken`: the team and developer an agent's token belongs to. */
    devAuth: DevTokenAuth | null;
  }
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** preHandler for agent endpoints: accepts only an active developer token. */
export function requireDevToken(deps: Pick<AppDeps, 'db' | 'now'>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    const auth = token ? await verifyDevToken(deps, token) : null;
    if (!auth) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    request.devAuth = auth;
  };
}

export function registerDevTokenAuth(app: FastifyInstance) {
  app.decorateRequest('devAuth', null);
}
