import { buildApp } from './app.ts';
import { createDb } from './db/client.ts';
import { loadEnv } from './env.ts';
import { createConsoleMailer, createResendMailer } from './lib/mailer.ts';
import { expireAllPending } from './modules/approvals/repo.ts';

// Refuses to start in production without an email service (see loadEnv).
const env = loadEnv();

const { db, close } = createDb(env.DATABASE_URL);
// A restart drops every held hook request, so approvals still pending can never be answered.
await expireAllPending(db, new Date());
const app = await buildApp({
  db,
  mailer: env.RESEND_API_KEY && env.EMAIL_FROM ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }) : createConsoleMailer(),
  webUrl: env.WEB_URL,
  publicUrl: env.PUBLIC_URL,
  cookieSecure: env.NODE_ENV === 'production',
  trustProxy: env.TRUST_PROXY,
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
