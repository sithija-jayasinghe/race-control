// pnpm db:migrate: brings the database up to the latest migration in ./drizzle. Production runs it
// before every start, so it must be safe to run again: migrations already applied are skipped.

import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  console.log('Database is up to date.');
} catch (error) {
  // Drizzle wraps the real error, and its message lists the query and parameters. A Postgres error's own
  // message can quote row values too, so only its code is shown. Others (can't connect, bad password)
  // say what went wrong without the connection string.
  const cause = error instanceof Error && error.cause ? error.cause : error;
  const { code, severity, message } = cause as { code?: string; severity?: string; message?: string };
  console.error(`Migration failed: ${severity ? `Postgres error ${code}` : message || code || 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
