import {
  MAX_RULES,
  errorResponseSchema,
  ruleInputSchema,
  ruleParamsSchema,
  rulePreviewRequestSchema,
  rulePreviewSchema,
  ruleSchema,
  ruleTestRequestSchema,
  ruleTestResultSchema,
  ruleUpdateSchema,
  ruleWithStatsSchema,
  teamParamsSchema,
} from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';
import * as repo from './repo.ts';
import { listRulesWithStats, previewRule, serializeRule, testRules } from './service.ts';

const errorResponses = { 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema };

/**
 * The Rules page (SPEC section 5). Every member can see the team's rules and try the test lane; only
 * leads change them. Rules are turned off rather than deleted, so their history stays.
 */
export function ruleRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const member = teamAccess(deps);
  const lead = teamAccess(deps, { lead: true });

  r.get(
    '/teams/:teamId/rules',
    { preHandler: member, schema: { params: teamParamsSchema, response: { 200: z.array(ruleWithStatsSchema), ...errorResponses } } },
    async (request) => listRulesWithStats(deps.db, getTeamAuth(request).teamId, deps.now()),
  );

  r.post(
    '/teams/:teamId/rules',
    {
      preHandler: lead,
      schema: {
        params: teamParamsSchema,
        body: ruleInputSchema,
        response: { 201: ruleSchema, 409: errorResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const auth = getTeamAuth(request);
      if ((await repo.countRules(deps.db, auth.teamId)) >= MAX_RULES) {
        return reply.code(409).send({ error: 'too_many_rules' });
      }
      const rule = await repo.insertRule(deps.db, { ...request.body, teamId: auth.teamId, createdBy: auth.userId, now: deps.now() });
      deps.rules.invalidate(auth.teamId);
      return reply.code(201).send(serializeRule(rule));
    },
  );

  // For teams made before starter rules existed: adds them once, to a team with no rules.
  r.post(
    '/teams/:teamId/rules/starter',
    {
      preHandler: lead,
      schema: { params: teamParamsSchema, response: { 204: z.null(), 409: errorResponseSchema, ...errorResponses } },
    },
    async (request, reply) => {
      const { teamId } = getTeamAuth(request);
      if ((await repo.countRules(deps.db, teamId)) > 0) return reply.code(409).send({ error: 'team_has_rules' });
      await repo.seedStarterRules(deps.db, teamId, deps.now());
      deps.rules.invalidate(teamId);
      return reply.code(204).send(null);
    },
  );

  r.patch(
    '/teams/:teamId/rules/:ruleId',
    { preHandler: lead, schema: { params: ruleParamsSchema, body: ruleUpdateSchema, response: { 200: ruleSchema, ...errorResponses } } },
    async (request, reply) => {
      const { teamId } = getTeamAuth(request);
      const rule = await repo.updateRule(deps.db, teamId, request.params.ruleId, request.body);
      if (!rule) return reply.code(404).send({ error: 'not_found' });
      deps.rules.invalidate(teamId);
      return serializeRule(rule);
    },
  );

  r.post(
    '/teams/:teamId/rules/test',
    {
      preHandler: member,
      schema: { params: teamParamsSchema, body: ruleTestRequestSchema, response: { 200: ruleTestResultSchema, ...errorResponses } },
    },
    async (request) => testRules(deps.db, getTeamAuth(request).teamId, request.body.input),
  );

  r.post(
    '/teams/:teamId/rules/preview',
    {
      preHandler: lead,
      schema: { params: teamParamsSchema, body: rulePreviewRequestSchema, response: { 200: rulePreviewSchema, ...errorResponses } },
    },
    async (request) => previewRule(deps.db, getTeamAuth(request).teamId, request.body, deps.now()),
  );
}
