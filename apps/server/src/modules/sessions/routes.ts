import {
  agentSessionSchema,
  errorResponseSchema,
  hookSetupSchema,
  liveEventSchema,
  sessionParamsSchema,
  sessionTimelineSchema,
  teamParamsSchema,
} from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { requireUser } from '../../plugins/auth.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';
import * as repo from './repo.ts';

const LIST_LIMIT = 50;
const EVENTS_LIMIT = 200;
const TIMELINE_LIMIT = 1000;

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

  r.get(
    '/teams/:teamId/events',
    {
      preHandler: teamAccess(deps),
      schema: {
        params: teamParamsSchema,
        response: { 200: z.array(liveEventSchema), 401: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request) => repo.listRecentEvents(deps.db, getTeamAuth(request).teamId, EVENTS_LIMIT),
  );

  r.get(
    '/teams/:teamId/sessions/:sessionId',
    {
      preHandler: teamAccess(deps),
      schema: {
        params: sessionParamsSchema,
        response: { 200: sessionTimelineSchema, 401: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { teamId } = getTeamAuth(request);
      const session = await repo.findSessionView(deps.db, teamId, request.params.sessionId);
      if (!session) return reply.code(404).send({ error: 'not_found' });
      const { events, truncated } = await repo.listSessionEvents(deps.db, teamId, session.id, TIMELINE_LIMIT);
      return { session: repo.serializeSession(session), events, truncated };
    },
  );

  // Where agents send hooks, for the settings snippet in the dashboard.
  r.get(
    '/setup/hooks',
    { preHandler: requireUser, schema: { response: { 200: hookSetupSchema, 401: errorResponseSchema } } },
    () => ({ hooksUrl: `${deps.publicUrl.replace(/\/+$/, '')}/hooks` }),
  );
}
