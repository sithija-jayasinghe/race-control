import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { devTokens, users } from '../../db/schema.ts';

const tokenColumns = {
  id: devTokens.id,
  label: devTokens.label,
  userId: devTokens.userId,
  userEmail: users.email,
  createdAt: devTokens.createdAt,
  lastUsedAt: devTokens.lastUsedAt,
};

const isActive = isNull(devTokens.revokedAt);

export async function countActiveTokens(db: DbOrTx, teamId: string, userId: string) {
  return db.$count(devTokens, and(eq(devTokens.teamId, teamId), eq(devTokens.userId, userId), isActive));
}

export async function insertToken(
  db: DbOrTx,
  values: { teamId: string; userId: string; tokenHash: string; label: string; createdAt: Date },
) {
  const [row] = await db.insert(devTokens).values(values).returning({ id: devTokens.id });
  if (!row) throw new Error('token insert returned nothing');
  return row.id;
}

/** Active tokens in a team, optionally only one member's. */
export async function listActiveTokens(db: DbOrTx, teamId: string, onlyUserId?: string) {
  return db
    .select(tokenColumns)
    .from(devTokens)
    .innerJoin(users, eq(users.id, devTokens.userId))
    .where(
      and(
        eq(devTokens.teamId, teamId),
        isActive,
        onlyUserId === undefined ? undefined : eq(devTokens.userId, onlyUserId),
      ),
    )
    .orderBy(desc(devTokens.createdAt));
}

export async function findActiveToken(db: DbOrTx, teamId: string, tokenId: string) {
  const [row] = await db
    .select(tokenColumns)
    .from(devTokens)
    .innerJoin(users, eq(users.id, devTokens.userId))
    .where(and(eq(devTokens.teamId, teamId), eq(devTokens.id, tokenId), isActive));
  return row ?? null;
}

export async function revokeToken(db: DbOrTx, teamId: string, tokenId: string, now: Date) {
  const rows = await db
    .update(devTokens)
    .set({ revokedAt: now })
    .where(and(eq(devTokens.teamId, teamId), eq(devTokens.id, tokenId), isActive))
    .returning({ id: devTokens.id });
  return rows.length > 0;
}

/** Looks a token up by its hash. Not team-scoped: the token is what tells us the team. */
export async function findActiveTokenByHash(db: DbOrTx, tokenHash: string) {
  const [row] = await db
    .select({
      id: devTokens.id,
      teamId: devTokens.teamId,
      userId: devTokens.userId,
      lastUsedAt: devTokens.lastUsedAt,
    })
    .from(devTokens)
    .where(and(eq(devTokens.tokenHash, tokenHash), isActive));
  return row ?? null;
}

/** Records use, but only if the last recorded use is older than `staleBefore`. */
export async function touchToken(db: DbOrTx, tokenId: string, now: Date, staleBefore: Date) {
  await db
    .update(devTokens)
    .set({ lastUsedAt: now })
    .where(
      and(eq(devTokens.id, tokenId), or(isNull(devTokens.lastUsedAt), lt(devTokens.lastUsedAt, staleBefore))),
    );
}
