import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect } from 'vitest';
import * as schema from '../../src/db/schema.ts';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** A fresh in-memory Postgres with all migrations applied. */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, client, close: () => client.close() };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];

/** Postgres error codes used in tests. */
export const PG = {
  foreignKeyViolation: '23503',
  uniqueViolation: '23505',
  invalidTextRepresentation: '22P02',
} as const;

function pgErrorCode(error: unknown): string | undefined {
  // Drizzle wraps driver errors; the Postgres error is the `cause`.
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export async function expectPgError(promise: Promise<unknown>, code: string) {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, `expected Postgres error ${code}, but the query succeeded`).toBeDefined();
  expect(pgErrorCode(error)).toBe(code);
}

/** One team with a lead, a session, an event and a rule. */
export async function seedTeam(db: TestDb, name: string) {
  const [team] = await db.insert(schema.teams).values({ name }).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${name.toLowerCase()}@example.test`, name: `${name} Lead` })
    .returning();
  if (!team || !user) throw new Error('seed failed');

  await db.insert(schema.memberships).values({ teamId: team.id, userId: user.id, role: 'lead' });

  const [session] = await db
    .insert(schema.sessions)
    .values({ teamId: team.id, userId: user.id, agent: 'claude_code', agentSessionId: `${name}-session` })
    .returning();
  if (!session) throw new Error('seed failed');

  const [event] = await db
    .insert(schema.events)
    .values({ teamId: team.id, sessionId: session.id, type: 'PreToolUse', toolName: 'Edit', target: 'src/app.ts' })
    .returning();
  const [rule] = await db
    .insert(schema.rules)
    .values({ teamId: team.id, name: 'Never touch .env', tool: 'Edit', pattern: '**/.env*', action: 'block' })
    .returning();
  if (!event || !rule) throw new Error('seed failed');

  return { team, user, session, event, rule };
}
