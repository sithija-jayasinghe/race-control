import type { Role } from '@race-control/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { memberships, teams, users } from '../../db/schema.ts';

export async function findMembership(db: DbOrTx, teamId: string, userId: string) {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)));
  return row ?? null;
}

export async function insertTeam(db: DbOrTx, name: string) {
  const [team] = await db.insert(teams).values({ name }).returning({ id: teams.id, name: teams.name });
  if (!team) throw new Error('team insert returned nothing');
  return team;
}

export async function insertMembership(db: DbOrTx, values: { teamId: string; userId: string; role: Role }) {
  await db.insert(memberships).values(values);
}

export async function findTeamName(db: DbOrTx, teamId: string) {
  const [row] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId));
  return row?.name ?? null;
}

export async function listMembers(db: DbOrTx, teamId: string) {
  return db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.teamId, teamId))
    .orderBy(asc(memberships.createdAt));
}

/** The team's leads, locked until the transaction ends so two changes can't remove the last one. */
export async function lockLeads(db: DbOrTx, teamId: string) {
  return db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.role, 'lead')))
    .for('update');
}

export async function updateMemberRole(db: DbOrTx, teamId: string, userId: string, role: Role) {
  const rows = await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)))
    .returning({ userId: memberships.userId });
  return rows.length > 0;
}

export async function deleteMembership(db: DbOrTx, teamId: string, userId: string) {
  const rows = await db
    .delete(memberships)
    .where(and(eq(memberships.teamId, teamId), eq(memberships.userId, userId)))
    .returning({ userId: memberships.userId });
  return rows.length > 0;
}
