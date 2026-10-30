import { buildApp } from './app.ts';
import { createDb } from './db/client.ts';
import { loadEnv } from './env.ts';
import { createConsoleMailer } from './lib/mailer.ts';

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  // Magic links are printed to the console in development. A real email service is added at deploy time.
  throw new Error('No email service is configured for production yet');
}

const { db, close } = createDb(env.DATABASE_URL);
const app = await buildApp({
  db,
  mailer: createConsoleMailer(),
  webUrl: env.WEB_URL,
  publicUrl: env.PUBLIC_URL,
  cookieSecure: false,
});
app.addHook('onClose', close);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
