import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify({
    ...options,
    logger:
      options.logger === undefined
        ? { redact: ['req.headers.authorization', 'req.headers.cookie'] }
        : options.logger,
  });

  app.get('/health', () => ({ status: 'ok' }));

  return app;
}
