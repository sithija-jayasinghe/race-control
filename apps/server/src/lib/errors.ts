import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/**
 * What may be logged about an unexpected error. Database errors carry the SQL query, its
 * parameters (emails, token hashes) and Postgres `detail` text with row values, so only the
 * error's type, codes and stack frames are kept, never its message.
 */
export function safeErrorForLog(error: unknown) {
  const chain: Array<Record<string, string | undefined>> = [];
  for (let current: unknown = error; current instanceof Error && chain.length < 5; current = current.cause) {
    const fields = current as Error & { code?: unknown; constraint?: unknown; table?: unknown };
    chain.push({
      name: current.name,
      code: typeof fields.code === 'string' ? fields.code : undefined,
      constraint: typeof fields.constraint === 'string' ? fields.constraint : undefined,
      table: typeof fields.table === 'string' ? fields.table : undefined,
    });
  }
  // A stack starts with the message, which can span several lines, so keep only the frames.
  const stack =
    error instanceof Error
      ? error.stack
          ?.split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 8)
          .join('\n')
      : undefined;
  return { chain, stack };
}

/** Error responses never include internal details, so nothing sensitive reaches the client. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: 'invalid_request',
        // Paths and rule messages only; zod messages don't echo the submitted values.
        issues: error.validation.map((issue) => ({ path: issue.instancePath, message: issue.message })),
      });
    }

    const status = error.statusCode ?? 500;
    if (status === 429) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    if (status < 500) {
      return reply.code(status).send({ error: 'bad_request' });
    }

    request.log.error({ err: safeErrorForLog(error) }, 'request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });
}
