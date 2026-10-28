import type { Role } from '@race-control/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { invites, memberships, teams } from '../../db/schema.ts';

const inviteColumns = {
  id: invites.id,
  role: invites.role,
  createdAt: invites.createdAt,
  expiresAt: invites.expiresAt,
};

export async function insertInvite(
  db: DbOrTx,
  values: { teamId: string; tokenHash: string; role: Role; createdBy: string; expiresAt: Date; createdAt: Date },
) {
  const [row] = await db.insert(invites).values(values).returning(inviteColumns);
  if (!row) throw new Error('invite insert returned nothing');
  return row;
}

const isActive = (now: Date) => and(isNull(invites.revokedAt), gt(invites.expiresAt, now));

export async function listActiveInvites(db: DbOrTx, teamId: string, now: Date) {
  return db
    .select(inviteColumns)
    .from(invites)
    .where(and(eq(invites.teamId, teamId), isActive(now)))
    .orderBy(desc(invites.createdAt));
}

/** Revokes an invite of this team. Returns false if the team has no such active invite. */
export async function revokeInvite(db: DbOrTx, teamId: string, inviteId: string, now: Date) {
  const rows = await db
    .update(invites)
    .set({ revokedAt: now })
    .where(and(eq(invites.teamId, teamId), eq(invites.id, inviteId), isActive(now)))
    .returning({ id: invites.id });
  return rows.length > 0;
}

/** Looks an invite up by its link. This is the one query not scoped by a team: the link is the proof. */
export async function findActiveInviteByTokenHash(db: DbOrTx, tokenHash: string, now: Date) {
  const [row] = await db
    .select({ teamId: invites.teamId, teamName: teams.name, role: invites.role, expiresAt: invites.expiresAt })
    .from(invites)
    .innerJoin(teams, eq(teams.id, invites.teamId))
    .where(and(eq(invites.tokenHash, tokenHash), isActive(now)));
  return row ?? null;
}

/** Adds the member unless they already belong to the team. Returns their role either way. */
export async function joinTeam(db: DbOrTx, teamId: string, userId: string, role: Role): Promise<Role> {
  await db.insert(memberships).values({ teamId, userId, role }).onConflictDoNothing();
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
  if (!row) throw new Error('membership missing after insert');
  return row.role;
}
