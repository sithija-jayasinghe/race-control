import {
  createTeamRequestSchema,
  errorResponseSchema,
  memberParamsSchema,
  memberSchema,
  myTeamSchema,
  teamParamsSchema,
  updateMemberRequestSchema,
} from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { requireUser } from '../../plugins/auth.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';
import * as repo from './repo.ts';
import { changeMemberRole, createTeam, removeMember, type MemberChangeResult } from './service.ts';

const errorResponses = { 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema };

const changeFailure = {
  not_found: { status: 404, error: 'not_found' },
  last_lead: { status: 409, error: 'last_lead' },
} as const satisfies Record<Exclude<MemberChangeResult, 'ok'>, { status: number; error: string }>;

export function teamRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const member = teamAccess(deps);
  const lead = teamAccess(deps, { lead: true });

  r.post(
    '/teams',
    {
      preHandler: requireUser,
      schema: { body: createTeamRequestSchema, response: { 201: myTeamSchema, 401: errorResponseSchema } },
    },
    async (request, reply) => {
      const team = await createTeam(deps.db, request.user!.id, request.body.name, deps.now());
      return reply.code(201).send(team);
    },
  );

  r.get(
    '/teams/:teamId',
    { preHandler: member, schema: { params: teamParamsSchema, response: { 200: myTeamSchema, ...errorResponses } } },
    async (request, reply) => {
      const auth = getTeamAuth(request);
      const name = await repo.findTeamName(deps.db, auth.teamId);
      if (name === null) return reply.code(404).send({ error: 'not_found' });
      return { id: auth.teamId, name, role: auth.role };
    },
  );

  r.get(
    '/teams/:teamId/members',
    {
      preHandler: member,
      schema: { params: teamParamsSchema, response: { 200: z.array(memberSchema), ...errorResponses } },
    },
    async (request) => {
      const members = await repo.listMembers(deps.db, getTeamAuth(request).teamId);
      return members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }));
    },
  );

  r.patch(
    '/teams/:teamId/members/:userId',
    {
      preHandler: lead,
      schema: {
        params: memberParamsSchema,
        body: updateMemberRequestSchema,
        response: { 204: z.null(), 409: errorResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await changeMemberRole(
        deps.db,
        getTeamAuth(request).teamId,
        request.params.userId,
        request.body.role,
      );
      if (result !== 'ok') {
        return reply.code(changeFailure[result].status).send({ error: changeFailure[result].error });
      }
      return reply.code(204).send(null);
    },
  );

  // Leads can remove anyone; any member can remove themselves (leave the team).
  r.delete(
    '/teams/:teamId/members/:userId',
    {
      preHandler: member,
      schema: { params: memberParamsSchema, response: { 204: z.null(), 409: errorResponseSchema, ...errorResponses } },
    },
    async (request, reply) => {
      const auth = getTeamAuth(request);
      if (auth.role !== 'lead' && request.params.userId !== auth.userId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const result = await removeMember(deps.db, auth.teamId, request.params.userId);
      if (result !== 'ok') {
        return reply.code(changeFailure[result].status).send({ error: changeFailure[result].error });
      }
      return reply.code(204).send(null);
    },
  );
}
