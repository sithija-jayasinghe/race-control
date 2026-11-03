import {
  authProvidersResponseSchema,
  errorResponseSchema,
  magicLinkRequestSchema,
  meResponseSchema,
  userSchema,
  verifyMagicLinkRequestSchema,
} from '@race-control/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../app.ts';
import { MailerError } from '../../lib/mailer.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, requireUser } from '../../plugins/auth.ts';
import * as repo from './repo.ts';
import { authorizeUrl, createOAuthAttempt, isOAuthProvider, OAUTH_PROVIDERS, OAuthError, safeNext, type OAuthProvider } from './oauth.ts';
import { requestMagicLink, signInWithProvider, verifyMagicLink } from './service.ts';

/** One GitHub or Google sign-in attempt: provider, state, PKCE verifier and where to go after. */
export const OAUTH_COOKIE = 'rc_oauth';
const OAUTH_TTL_S = 10 * 60;

const oauthParamsSchema = z.object({ provider: z.string().max(20) });
const oauthStartQuerySchema = z.object({ next: z.string().max(1000).optional() });
const oauthCallbackQuerySchema = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
});

export function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.cookieSecure,
    path: '/',
  } as const;

  r.post(
    '/auth/magic-link',
    {
      schema: { body: magicLinkRequestSchema, response: { 202: z.object({ ok: z.literal(true) }), 502: errorResponseSchema } },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      try {
        await requestMagicLink(deps, request.body.email);
      } catch (error) {
        if (!(error instanceof MailerError)) throw error;
        // Whether sending works has nothing to do with who has an account, so saying so reveals nothing.
        request.log.error({ err: { name: error.name, message: error.message } }, 'sign-in email not sent');
        return reply.code(502).send({ error: 'email_failed' });
      }
      return reply.code(202).send({ ok: true });
    },
  );

  r.post(
    '/auth/verify',
    {
      schema: {
        body: verifyMagicLinkRequestSchema,
        response: { 200: z.object({ user: userSchema }), 400: errorResponseSchema },
      },
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = await verifyMagicLink(deps, request.body.token);
      if (!result) {
        return reply.code(400).send({ error: 'invalid_or_expired_link' });
      }
      reply.setCookie(SESSION_COOKIE, result.sessionToken, {
        ...cookieOptions,
        maxAge: SESSION_TTL_MS / 1000,
      });
      return { user: result.user };
    },
  );

  // GitHub and Google send people back here, through the web app's `/api` so the login cookie stays
  // on the dashboard's site (ADR 0002).
  const redirectUri = (provider: OAuthProvider) => new URL(`/api/auth/${provider}/callback`, deps.webUrl).toString();
  const toWeb = (path: string) => new URL(path, deps.webUrl).toString();
  const enabled = (name: string): name is OAuthProvider => isOAuthProvider(name) && Boolean(deps.oauth[name]);

  r.get('/auth/providers', { schema: { response: { 200: authProvidersResponseSchema } } }, () => ({
    providers: OAUTH_PROVIDERS.filter((provider) => deps.oauth[provider]),
  }));

  r.get(
    '/auth/:provider/start',
    {
      schema: { params: oauthParamsSchema, querystring: oauthStartQuerySchema },
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const { provider } = request.params;
      if (!enabled(provider)) return reply.code(404).send({ error: 'not_found' });
      const attempt = createOAuthAttempt();
      const next = Buffer.from(safeNext(request.query.next)).toString('base64url');
      reply.setCookie(OAUTH_COOKIE, [provider, attempt.state, attempt.verifier, next].join('.'), { ...cookieOptions, maxAge: OAUTH_TTL_S });
      return reply.redirect(authorizeUrl(provider, deps.oauth[provider]!, { ...attempt, redirectUri: redirectUri(provider) }));
    },
  );

  r.get(
    '/auth/:provider/callback',
    {
      schema: { params: oauthParamsSchema, querystring: oauthCallbackQuerySchema },
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const { provider } = request.params;
      if (!enabled(provider)) return reply.code(404).send({ error: 'not_found' });
      const failed = (error: string) => reply.redirect(toWeb(`/sign-in?${new URLSearchParams({ error, provider }).toString()}`));

      // The attempt is single-use, whatever happens next.
      const [cookieProvider, state, verifier, next] = (request.cookies[OAUTH_COOKIE] ?? '').split('.');
      reply.clearCookie(OAUTH_COOKIE, cookieOptions);
      const { code, error } = request.query;
      if (error) return failed('cancelled');
      if (!code || !state || !verifier || cookieProvider !== provider || request.query.state !== state) return failed('expired');

      try {
        const result = await signInWithProvider(deps, provider, { code, verifier, redirectUri: redirectUri(provider) });
        if (result === 'no_verified_email') return failed('no_verified_email');
        reply.setCookie(SESSION_COOKIE, result.sessionToken, { ...cookieOptions, maxAge: SESSION_TTL_MS / 1000 });
        return reply.redirect(toWeb(safeNext(Buffer.from(next ?? '', 'base64url').toString())));
      } catch (err) {
        if (!(err instanceof OAuthError)) throw err;
        request.log.error({ err: { name: err.name, message: err.message } }, 'provider sign-in failed');
        return failed('failed');
      }
    },
  );

  r.post('/auth/logout', async (request, reply) => {
    if (request.authSessionId) {
      await repo.deleteSession(deps.db, request.authSessionId);
    }
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.code(204).send();
  });

  r.get(
    '/me',
    { preHandler: requireUser, schema: { response: { 200: meResponseSchema, 401: errorResponseSchema } } },
    async (request) => {
      // requireUser guarantees a user here.
      const user = request.user!;
      return { user, teams: await repo.listTeamsForUser(deps.db, user.id) };
    },
  );
}
