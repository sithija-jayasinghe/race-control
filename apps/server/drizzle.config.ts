import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Only `db:migrate` and `db:studio` connect; `db:generate` works without a database.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/race_control',
  },
  strict: true,
  verbose: true,
});
