import { teamParamsSchema, type LiveMessage } from '@race-control/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../app.ts';
import { getTeamAuth, teamAccess } from '../../plugins/team-access.ts';

const HEARTBEAT_MS = 30_000;

/**
 * Browsers send cookies on WebSocket handshakes from any site, so only accept connections that come
 * from the dashboard itself.
 */
function requireDashboardOrigin(webUrl: string) {
  const allowed = new URL(webUrl).origin;
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.origin !== allowed) {
      await reply.code(403).send({ error: 'forbidden' });
    }
  };
}

/**
 * `GET /teams/:teamId/live`: a WebSocket that pushes every new session update and event of one team,
 * to signed-in members only. Membership is checked once when connecting.
 */
export function liveRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get(
    '/teams/:teamId/live',
    {
      websocket: true,
      schema: { params: teamParamsSchema },
      preHandler: [requireDashboardOrigin(deps.webUrl), teamAccess(deps)],
    },
    (socket, request) => {
      const { teamId } = getTeamAuth(request);
      const send = (message: LiveMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      };

      const unsubscribe = deps.bus.subscribe(teamId, send);
      const heartbeat = setInterval(() => {
        if (socket.readyState === socket.OPEN) socket.ping();
      }, HEARTBEAT_MS);

      socket.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      // The channel only sends; anything a client sends is ignored.
      socket.on('message', () => {});
      send({ type: 'hello', teamId });
    },
  );
}
