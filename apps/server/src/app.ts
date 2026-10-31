import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Database } from './db/client.ts';
import { registerErrorHandler } from './lib/errors.ts';
import { TeamBus } from './lib/team-bus.ts';
import type { Mailer } from './lib/mailer.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { flagRoutes } from './modules/flags/routes.ts';
import { hookRoutes } from './modules/hooks/routes.ts';
import { liveRoutes } from './modules/sessions/live.ts';
import { sessionRoutes } from './modules/sessions/routes.ts';
import { inviteRoutes } from './modules/invites/routes.ts';
import { teamRoutes } from './modules/teams/routes.ts';
import { tokenRoutes } from './modules/tokens/routes.ts';
import { registerAuth } from './plugins/auth.ts';
import { registerDevTokenAuth } from './plugins/dev-token-auth.ts';
import { registerTeamAccess } from './plugins/team-access.ts';

export type AppDeps = {
  db: Database;
  mailer: Mailer;
  /** Base URL of the dashboard, used in magic links. */
  webUrl: string;
  /** Base URL agents use to reach this server, used in the hook settings. */
  publicUrl: string;
  /** Send cookies only over HTTPS. True in production. */
  cookieSecure: boolean;
  /** The current time. Tests pass a fake clock. */
  now: () => Date;
  /** Live messages for each team's dashboards. */
  bus: TeamBus;
};

export type BuildAppOptions = Omit<AppDeps, 'now' | 'bus'> & {
  now?: () => Date;
  bus?: TeamBus;
  logger?: FastifyServerOptions['logger'];
};

export async function buildApp({
  logger,
  now = () => new Date(),
  bus = new TeamBus(),
  ...rest
}: BuildAppOptions): Promise<FastifyInstance> {
  const deps: AppDeps = { ...rest, now, bus };
  const app = Fastify({
    logger: logger ?? { redact: ['req.headers.authorization', 'req.headers.cookie'] },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  // Awaited so their hooks are in place before ours and before any route is added.
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  registerAuth(app, deps);
  registerTeamAccess(app);
  registerDevTokenAuth(app);

  app.get('/health', () => ({ status: 'ok' }));
  authRoutes(app, deps);
  teamRoutes(app, deps);
  inviteRoutes(app, deps);
  tokenRoutes(app, deps);
  hookRoutes(app, deps);
  sessionRoutes(app, deps);
  flagRoutes(app, deps);
  liveRoutes(app, deps);

  return app;
}
