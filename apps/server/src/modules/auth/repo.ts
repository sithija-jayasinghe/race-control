import type { User } from '@race-control/shared';
import { and, asc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { authIdentities, authSessions, loginTokens, memberships, teams, users } from '../../db/schema.ts';

const userColumns = { id: users.id, email: users.email, name: users.name };

export async function countRecentLoginTokens(db: DbOrTx, email: string, since: Date): Promise<number> {
  return db.$count(loginTokens, and(eq(loginTokens.email, email), gte(loginTokens.createdAt, since)));
}

export async function insertLoginToken(
  db: DbOrTx,
  values: { email: string; tokenHash: string; expiresAt: Date; createdAt: Date },
) {
  await db.insert(loginTokens).values(values);
}

/** Marks a magic link as used, only if it is unused and unexpired. Returns its email, or null. */
export async function consumeLoginToken(db: DbOrTx, tokenHash: string, now: Date): Promise<string | null> {
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.tokenHash, tokenHash), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
    .returning({ email: loginTokens.email });
  return row?.email ?? null;
}

/** Finds the user who owns this email, creating the user and the email identity if needed. */
export async function findOrCreateEmailUser(db: DbOrTx, email: string): Promise<User> {
  const [identity] = await db
    .select(userColumns)
    .from(authIdentities)
    .innerJoin(users, eq(users.id, authIdentities.userId))
    .where(and(eq(authIdentities.provider, 'email'), eq(authIdentities.providerUserId, email)));
  if (identity) return identity;

  // Opening the magic link proves the person owns this email, so it is safe to attach it
  // to an existing account with the same email (for example one created via GitHub).
  await db.insert(users).values({ email }).onConflictDoNothing();
  const [user] = await db
    .select(userColumns)
    .from(users)
    .where(eq(sql`lower(${users.email})`, email));
  if (!user) throw new Error('user missing after insert');

  await db
    .insert(authIdentities)
    .values({ userId: user.id, provider: 'email', providerUserId: email, email })
    .onConflictDoNothing();
  return user;
}

export async function insertAuthSession(
  db: DbOrTx,
  values: { userId: string; tokenHash: string; expiresAt: Date; now: Date },
) {
  await db.insert(authSessions).values({
    userId: values.userId,
    tokenHash: values.tokenHash,
    expiresAt: values.expiresAt,
    lastSeenAt: values.now,
    createdAt: values.now,
  });
}

export async function findSessionByTokenHash(db: DbOrTx, tokenHash: string, now: Date) {
  const [row] = await db
    .select({ sessionId: authSessions.id, lastSeenAt: authSessions.lastSeenAt, user: userColumns })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, now)));
  return row ?? null;
}

export async function touchSession(db: DbOrTx, sessionId: string, now: Date) {
  await db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, sessionId));
}

export async function deleteSession(db: DbOrTx, sessionId: string) {
  await db.delete(authSessions).where(eq(authSessions.id, sessionId));
}

/** The teams a user belongs to. Only ever called with the signed-in user's own id. */
export async function listTeamsForUser(db: DbOrTx, userId: string) {
  return db
    .select({ id: teams.id, name: teams.name, role: memberships.role })
    .from(memberships)
    .innerJoin(teams, eq(teams.id, memberships.teamId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(teams.name));
}
