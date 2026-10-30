import { agentSessionSchema, errorResponseSchema, hookSetupSchema, teamParamsSchema } from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { requireUser } from '../../plugins/auth.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';
import * as repo from './repo.ts';

const LIST_LIMIT = 50;

export function sessionRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/teams/:teamId/sessions',
    {
      preHandler: teamAccess(deps),
      schema: {
        params: teamParamsSchema,
        response: { 200: z.array(agentSessionSchema), 401: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => {
      const rows = await repo.listRecentSessions(deps.db, getTeamAuth(request).teamId, LIST_LIMIT);
      return rows.map(repo.serializeSession);
    },
  );

  // Where agents send hooks, for the settings snippet in the dashboard.
  r.get(
    '/setup/hooks',
    { preHandler: requireUser, schema: { response: { 200: hookSetupSchema, 401: errorResponseSchema } } },
    () => ({ hooksUrl: `${deps.publicUrl.replace(/\/+$/, '')}/hooks` }),
  );
}
