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
 * Answers fast with an empty 200, which Claude Code reads as "no decision", so agents carry on, unless a
 * team rule decides or there's a Team Radio heads-up for `additionalContext`. A block answers `deny`; a
 * rule that needs a lead holds the request until one answers (`allow` or `deny`) or the wait runs out
 * (`deny`). Events Race Control doesn't record are accepted and ignored.
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

      // An agent that gives up on a held request (the developer pressed Esc) closes the connection.
      const hungUp = new AbortController();
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) hungUp.abort();
      });
      const { permission, additionalContext } = await ingestHookEvent(deps, request.devAuth!, event, parsed.data, hungUp.signal);
      if (!permission && !additionalContext) return reply.code(200).send();
      return reply.code(200).send({
        hookSpecificOutput: {
          hookEventName: event,
          ...(permission ? { permissionDecision: permission.decision, permissionDecisionReason: permission.reason } : {}),
          ...(additionalContext ? { additionalContext } : {}),
        },
      });
    },
  );
}
