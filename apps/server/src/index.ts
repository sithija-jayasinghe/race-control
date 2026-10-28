import { buildApp } from './app.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const app = buildApp();

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
