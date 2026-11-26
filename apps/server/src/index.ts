import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { createDb } from './db/client.ts';
import { loadEnv } from './env.ts';
import { describeDbError } from './lib/errors.ts';
import { createConsoleMailer, createResendMailer } from './lib/mailer.ts';
import { expireAllPending } from './modules/approvals/repo.ts';

// Refuses to start in production without an email service (see loadEnv).
const env = loadEnv();

const webDist = env.WEB_DIST && resolve(env.WEB_DIST);
if (webDist && !existsSync(resolve(webDist, 'index.html'))) {
  throw new Error(`WEB_DIST has no index.html (${webDist}). Build the web app first: pnpm --filter @race-control/web build`);
}

const { db, close } = createDb(env.DATABASE_URL);
// A restart drops every held hook request, so approvals still pending can never be answered. This is also
// the first query, so a database that's down or not migrated stops the server here, with one clear line
// instead of Drizzle's error, which quotes the query and its parameters.
try {
  await expireAllPending(db, new Date());
} catch (error) {
  console.error(
    `Can't use the database (${describeDbError(error)}). Check DATABASE_URL, that Postgres is running, and that migrations have run (pnpm db:migrate).`,
  );
  await close();
  process.exit(1);
}
const app = await buildApp({
  db,
  mailer: env.RESEND_API_KEY && env.EMAIL_FROM ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }) : createConsoleMailer(),
  webUrl: env.WEB_URL,
  publicUrl: env.PUBLIC_URL,
  cookieSecure: env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY,
  webDist,
  oauth: {
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}),
  },
});
app.addHook('onClose', close);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
