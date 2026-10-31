import { errorResponseSchema, teamParamsSchema, yellowFlagSchema } from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';
import { findYellowFlags } from './repo.ts';

export function flagRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Current yellow flags, so the Pit wall is right on load. New ones arrive on the live channel.
  r.get(
    '/teams/:teamId/flags',
    {
      preHandler: teamAccess(deps),
      schema: {
        params: teamParamsSchema,
        response: { 200: z.array(yellowFlagSchema), 401: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => findYellowFlags(deps.db, getTeamAuth(request).teamId, deps.now()),
  );
}
