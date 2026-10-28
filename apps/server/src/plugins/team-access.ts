import { teamParamsSchema, type Role } from '@race-control/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app.ts';
import { findMembership } from '../modules/teams/repo.ts';

export type TeamAuth = { teamId: string; userId: string; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set only after the signed-in user's membership of `:teamId` is confirmed.
     * Team-scoped queries take their team id from here, never from the URL or body.
     */
    auth: TeamAuth | null;
  }
}

export function registerTeamAccess(app: FastifyInstance) {
  app.decorateRequest('auth', null);
}

/**
 * preHandler for routes under `/teams/:teamId`. Answers 404 for teams the user isn't in, the same
 * as for teams that don't exist, so other teams can't be discovered. `lead: true` also requires
 * the lead role (403 for other members, who already know the team exists).
 */
export function teamAccess(deps: Pick<AppDeps, 'db'>, options: { lead?: boolean } = {}) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const params = teamParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const membership = await findMembership(deps.db, params.data.teamId, request.user.id);
    if (!membership) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (options.lead && membership.role !== 'lead') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    request.auth = { teamId: params.data.teamId, userId: request.user.id, role: membership.role };
  };
}

/** The confirmed team access. Only call in handlers behind `teamAccess`. */
export function getTeamAuth(request: FastifyRequest): TeamAuth {
  if (!request.auth) throw new Error('teamAccess preHandler missing on this route');
  return request.auth;
}
