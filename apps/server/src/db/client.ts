import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.ts';

/** Any Drizzle Postgres database with our schema: postgres-js in the app, PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Query functions accept either, so they can run inside a transaction. */
export type DbOrTx = Database | Transaction;

export function createDb(databaseUrl: string): { db: Database; close: () => Promise<void> } {
  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}
