import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Database } from './db/client.ts';
import { registerErrorHandler } from './lib/errors.ts';
import type { Mailer } from './lib/mailer.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { inviteRoutes } from './modules/invites/routes.ts';
import { teamRoutes } from './modules/teams/routes.ts';
import { registerAuth } from './plugins/auth.ts';
import { registerTeamAccess } from './plugins/team-access.ts';

export type AppDeps = {
  db: Database;
  mailer: Mailer;
  /** Base URL of the dashboard, used in magic links. */
  webUrl: string;
  /** Send cookies only over HTTPS. True in production. */
  cookieSecure: boolean;
  /** The current time. Tests pass a fake clock. */
  now: () => Date;
};

export type BuildAppOptions = Omit<AppDeps, 'now'> & {
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
};

export async function buildApp({ logger, now = () => new Date(), ...rest }: BuildAppOptions): Promise<FastifyInstance> {
  const deps: AppDeps = { ...rest, now };
  const app = Fastify({
    logger: logger ?? { redact: ['req.headers.authorization', 'req.headers.cookie'] },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  // Awaited so their hooks are in place before ours and before any route is added.
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerAuth(app, deps);
  registerTeamAccess(app);

  app.get('/health', () => ({ status: 'ok' }));
  authRoutes(app, deps);
  teamRoutes(app, deps);
  inviteRoutes(app, deps);

  return app;
}
