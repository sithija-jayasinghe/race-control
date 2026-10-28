import {
  createInviteRequestSchema,
  createdInviteSchema,
  errorResponseSchema,
  inviteParamsSchema,
  invitePreviewSchema,
  inviteSchema,
  inviteTokenRequestSchema,
  myTeamSchema,
  teamParamsSchema,
} from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { requireUser } from '../../plugins/auth.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';
import * as repo from './repo.ts';
import { acceptInvite, createInvite, previewInvite } from './service.ts';

const errorResponses = { 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema };
const tokenRateLimit = { rateLimit: { max: 20, timeWindow: '15 minutes' } };
const invalidInvite = { error: 'invalid_or_expired_invite' } as const;

export function inviteRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const lead = teamAccess(deps, { lead: true });

  r.post(
    '/teams/:teamId/invites',
    {
      preHandler: lead,
      schema: {
        params: teamParamsSchema,
        body: createInviteRequestSchema,
        response: { 201: createdInviteSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const invite = await createInvite(deps, getTeamAuth(request), request.body.role);
      return reply.code(201).send(invite);
    },
  );

  r.get(
    '/teams/:teamId/invites',
    {
      preHandler: lead,
      schema: { params: teamParamsSchema, response: { 200: z.array(inviteSchema), ...errorResponses } },
    },
    async (request) => {
      const invites = await repo.listActiveInvites(deps.db, getTeamAuth(request).teamId, deps.now());
      return invites.map((i) => ({
        ...i,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      }));
    },
  );

  r.delete(
    '/teams/:teamId/invites/:inviteId',
    {
      preHandler: lead,
      schema: { params: inviteParamsSchema, response: { 204: z.null(), ...errorResponses } },
    },
    async (request, reply) => {
      const revoked = await repo.revokeInvite(deps.db, getTeamAuth(request).teamId, request.params.inviteId, deps.now());
      if (!revoked) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send(null);
    },
  );

  // The token travels in the body, not the URL, so it stays out of logs.
  r.post(
    '/invites/preview',
    {
      config: tokenRateLimit,
      schema: { body: inviteTokenRequestSchema, response: { 200: invitePreviewSchema, 400: errorResponseSchema } },
    },
    async (request, reply) => {
      const preview = await previewInvite(deps, request.body.token);
      if (!preview) return reply.code(400).send(invalidInvite);
      return preview;
    },
  );

  r.post(
    '/invites/accept',
    {
      preHandler: requireUser,
      config: tokenRateLimit,
      schema: {
        body: inviteTokenRequestSchema,
        response: { 200: myTeamSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const team = await acceptInvite(deps, request.body.token, request.user!.id);
      if (!team) return reply.code(400).send(invalidInvite);
      return team;
    },
  );
}
