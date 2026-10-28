import type { MyTeam, Role } from '@race-control/shared';
import type { Database } from '../../db/client.ts';
import * as repo from './repo.ts';

/** Creates a team with the creator as its first lead. */
export async function createTeam(db: Database, userId: string, name: string): Promise<MyTeam> {
  return db.transaction(async (tx) => {
    const team = await repo.insertTeam(tx, name);
    await repo.insertMembership(tx, { teamId: team.id, userId, role: 'lead' });
    return { ...team, role: 'lead' };
  });
}

export type MemberChangeResult = 'ok' | 'not_found' | 'last_lead';

/** True if this change would leave the team with no lead. */
function removesLastLead(leads: Array<{ userId: string }>, userId: string) {
  return leads.length === 1 && leads[0]?.userId === userId;
}

export async function changeMemberRole(
  db: Database,
  teamId: string,
  userId: string,
  role: Role,
): Promise<MemberChangeResult> {
  return db.transaction(async (tx) => {
    const leads = await repo.lockLeads(tx, teamId);
    if (role !== 'lead' && removesLastLead(leads, userId)) return 'last_lead';
    return (await repo.updateMemberRole(tx, teamId, userId, role)) ? 'ok' : 'not_found';
  });
}

export async function removeMember(db: Database, teamId: string, userId: string): Promise<MemberChangeResult> {
  return db.transaction(async (tx) => {
    const leads = await repo.lockLeads(tx, teamId);
    if (removesLastLead(leads, userId)) return 'last_lead';
    return (await repo.deleteMembership(tx, teamId, userId)) ? 'ok' : 'not_found';
  });
}
