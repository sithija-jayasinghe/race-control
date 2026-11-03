import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { stripApiPrefix } from '../lib/api-prefix.ts';

// In production one server is the whole site (ADR 0003): the dashboard's pages and files, its API
// under `/api`, and the agent hooks. The web app's paths (`/teams`, `/auth/verify`, ...) overlap the
// API's, so every browser path that isn't the API, a hook or the health check goes to the web app.

/** Where the web app's files are routed inside the server. Never seen by browsers. */
export const WEB_PREFIX = '/_web';

/** Which route a request goes to: the API without its prefix, an agent route as is, or the web app. */
export function routeUrl(url: string, servingWeb: boolean): string {
  const api = stripApiPrefix(url);
  if (api !== url || !servingWeb) return api;
  const path = url.split('?')[0]!;
  if (path === '/health' || path === '/hooks' || path.startsWith('/hooks/')) return url;
  return `${WEB_PREFIX}${url}`;
}

// Vite names built files by their content, so they can be cached for good. Everything else, above all
// index.html, is checked every time, so a deploy reaches people on their next page load.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

/** Serves the built web app from `root`, falling back to index.html for the app's own routes. */
export async function registerWeb(app: FastifyInstance, root: string) {
  await app.register(
    async (web) => {
      web.addHook('onSend', async (_request, reply) => {
        // The approval screen has Approve and Deny buttons, so no other site may frame the dashboard.
        reply.header('x-frame-options', 'DENY');
        reply.header('x-content-type-options', 'nosniff');
        reply.header('referrer-policy', 'same-origin');
      });

      await web.register(fastifyStatic, {
        root,
        index: 'index.html',
        cacheControl: false,
        setHeaders: (reply, path) => {
          reply.header('cache-control', path.includes('/assets/') ? IMMUTABLE : REVALIDATE);
        },
      });

      web.setNotFoundHandler((request, reply) => {
        // A missing file (an old build's script, a typo'd image) is a real 404, not the app.
        const lastSegment = request.url.split('?')[0]!.split('/').pop() ?? '';
        if ((request.method !== 'GET' && request.method !== 'HEAD') || lastSegment.includes('.')) {
          return reply.code(404).send({ error: 'not_found' });
        }
        return reply.header('cache-control', REVALIDATE).sendFile('index.html');
      });
    },
    { prefix: WEB_PREFIX },
  );
}
