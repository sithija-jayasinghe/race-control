import { approvalDecisionSchema, approvalParamsSchema, approvalSchema, errorResponseSchema, teamParamsSchema } from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';
import { findApproval, listApprovals, serializeApproval } from './repo.ts';
import { decideApproval } from './service.ts';

const errorResponses = { 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema };
const HISTORY_MS = 24 * 60 * 60 * 1000;

/** Approvals (SPEC section 5): every member can see them; only leads decide. */
export function approvalRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const member = teamAccess(deps);
  const lead = teamAccess(deps, { lead: true });

  // Waiting approvals, and the last day's decisions.
  r.get(
    '/teams/:teamId/approvals',
    { preHandler: member, schema: { params: teamParamsSchema, response: { 200: z.array(approvalSchema), ...errorResponses } } },
    async (request) => {
      const rows = await listApprovals(deps.db, getTeamAuth(request).teamId, new Date(deps.now().getTime() - HISTORY_MS));
      return rows.map((row) => serializeApproval(row, deps.approvalWaitMs));
    },
  );

  r.get(
    '/teams/:teamId/approvals/:approvalId',
    { preHandler: member, schema: { params: approvalParamsSchema, response: { 200: approvalSchema, ...errorResponses } } },
    async (request, reply) => {
      const row = await findApproval(deps.db, getTeamAuth(request).teamId, request.params.approvalId);
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return serializeApproval(row, deps.approvalWaitMs);
    },
  );

  r.post(
    '/teams/:teamId/approvals/:approvalId/decision',
    {
      preHandler: lead,
      schema: {
        params: approvalParamsSchema,
        body: approvalDecisionSchema,
        response: { 200: approvalSchema, 409: errorResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await decideApproval(deps, getTeamAuth(request), request.params.approvalId, request.body.decision);
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result === 'already_decided') return reply.code(409).send({ error: 'already_decided' });
      return result.approval;
    },
  );
}
