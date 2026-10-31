import { hookPayloadSchemas, isIngestedHookEvent } from '@race-control/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { hashToken } from '../../lib/secure-token.ts';
import { bearerToken, requireDevToken } from '../../plugins/dev-token-auth.ts';
import { ingestHookEvent } from './service.ts';

const paramsSchema = z.object({ event: z.string().min(1).max(100) });

/** Tool results (file reads, command output) can be large. We discard them, but must accept them. */
const BODY_LIMIT = 5 * 1024 * 1024;

/** Rate limits are per token, so one busy laptop can't slow down the rest of the team. */
function rateLimitKey(request: FastifyRequest): string {
  const token = bearerToken(request);
  return token ? `token:${hashToken(token)}` : `ip:${request.ip}`;
}

/**
 * `POST /hooks/:event`: where Claude Code's HTTP hooks send events (SPEC section 4).
 *
 * Answers fast with an empty 200, which Claude Code reads as "no decision", so agents carry on. The one
 * exception is a Team Radio heads-up, sent as `additionalContext` with still no decision. Events Race
 * Control doesn't record are accepted and ignored. Guardrail decisions arrive in Week 4.
 */
export function hookRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post(
    '/hooks/:event',
    {
      bodyLimit: BODY_LIMIT,
      preHandler: requireDevToken(deps),
      config: { rateLimit: { max: 1200, timeWindow: '1 minute', keyGenerator: rateLimitKey } },
    },
    async (request, reply) => {
      const { event } = paramsSchema.parse(request.params);
      if (!isIngestedHookEvent(event)) {
        return reply.code(200).send();
      }

      const parsed = hookPayloadSchemas[event].safeParse(request.body);
      if (!parsed.success || parsed.data.hook_event_name !== event) {
        return reply.code(400).send({ error: 'invalid_payload' });
      }

      const outcome = await ingestHookEvent(deps, request.devAuth!, event, parsed.data);
      if (outcome.additionalContext) {
        return reply.code(200).send({ hookSpecificOutput: { hookEventName: event, additionalContext: outcome.additionalContext } });
      }
      return reply.code(200).send();
    },
  );
}
