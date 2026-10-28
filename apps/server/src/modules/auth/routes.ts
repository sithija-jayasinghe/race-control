import {
  errorResponseSchema,
  magicLinkRequestSchema,
  meResponseSchema,
  userSchema,
  verifyMagicLinkRequestSchema,
} from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, requireUser } from '../../plugins/auth.ts';
import * as repo from './repo.ts';
import { requestMagicLink, verifyMagicLink } from './service.ts';

export function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.cookieSecure,
    path: '/',
  } as const;

  r.post(
    '/auth/magic-link',
    {
      schema: { body: magicLinkRequestSchema, response: { 202: z.object({ ok: z.literal(true) }) } },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      await requestMagicLink(deps, request.body.email);
      return reply.code(202).send({ ok: true });
    },
  );

  r.post(
    '/auth/verify',
    {
      schema: {
        body: verifyMagicLinkRequestSchema,
        response: { 200: z.object({ user: userSchema }), 400: errorResponseSchema },
      },
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = await verifyMagicLink(deps, request.body.token);
      if (!result) {
        return reply.code(400).send({ error: 'invalid_or_expired_link' });
      }
      reply.setCookie(SESSION_COOKIE, result.sessionToken, {
        ...cookieOptions,
        maxAge: SESSION_TTL_MS / 1000,
      });
      return { user: result.user };
    },
  );

  r.post('/auth/logout', async (request, reply) => {
    if (request.authSessionId) {
      await repo.deleteSession(deps.db, request.authSessionId);
    }
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.code(204).send();
  });

  r.get(
    '/me',
    { preHandler: requireUser, schema: { response: { 200: meResponseSchema, 401: errorResponseSchema } } },
    async (request) => {
      // requireUser guarantees a user here.
      const user = request.user!;
      return { user, teams: await repo.listTeamsForUser(deps.db, user.id) };
    },
  );
}
