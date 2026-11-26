// pnpm db:migrate: brings the database up to the latest migration in ./drizzle. Production runs it
// before every start, so it must be safe to run again: migrations already applied are skipped.

import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { describeDbError } from '../src/lib/errors.ts';

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
  console.error(`Migration failed: ${describeDbError(error)}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
