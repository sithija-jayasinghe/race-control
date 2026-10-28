import {
  createDevTokenRequestSchema,
  createdDevTokenSchema,
  devTokenParamsSchema,
  devTokenSchema,
  errorResponseSchema,
  teamParamsSchema,
} from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';
import * as repo from './repo.ts';
import { createDevToken, revokeDevToken, serializeToken, visibleTo } from './service.ts';

const errorResponses = { 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema };

export function tokenRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const member = teamAccess(deps);

  r.post(
    '/teams/:teamId/tokens',
    {
      preHandler: member,
      schema: {
        params: teamParamsSchema,
        body: createDevTokenRequestSchema,
        response: { 201: createdDevTokenSchema, 409: errorResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const created = await createDevToken(deps, getTeamAuth(request), request.body.label);
      if (created === 'too_many_tokens') return reply.code(409).send({ error: 'too_many_tokens' });
      // The only time the token is ever sent. Make sure nothing caches it.
      return reply.code(201).header('cache-control', 'no-store').send(created);
    },
  );

  r.get(
    '/teams/:teamId/tokens',
    {
      preHandler: member,
      schema: { params: teamParamsSchema, response: { 200: z.array(devTokenSchema), ...errorResponses } },
    },
    async (request) => {
      const auth = getTeamAuth(request);
      const tokens = await repo.listActiveTokens(deps.db, auth.teamId, visibleTo(auth));
      return tokens.map(serializeToken);
    },
  );

  r.delete(
    '/teams/:teamId/tokens/:tokenId',
    {
      preHandler: member,
      schema: { params: devTokenParamsSchema, response: { 204: z.null(), ...errorResponses } },
    },
    async (request, reply) => {
      const revoked = await revokeDevToken(deps, getTeamAuth(request), request.params.tokenId);
      if (!revoked) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send(null);
    },
  );
}
