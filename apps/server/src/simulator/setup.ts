import { DEV_TOKEN_PREFIX } from '@race-control/shared';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '../db/client.ts';
import { devTokens, memberships, rules, teams, users } from '../db/schema.ts';
import { createSecureToken, hashToken } from '../lib/secure-token.ts';
import { seedStarterRules } from '../modules/rules/repo.ts';
import { DEMO_DOMAIN, DEMO_LEAD, DEMO_TEAM_NAME, DRIVERS } from './scenario.ts';

export class SimulatorSetupError extends Error {}

/** The Demo team: the team named "Demo team" that the demo lead belongs to. Never a real team. */
async function findDemoTeamIds(db: DbOrTx): Promise<string[]> {
  const rows = await db
    .select({ id: teams.id })
    .from(teams)
    .innerJoin(memberships, eq(memberships.teamId, teams.id))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(teams.name, DEMO_TEAM_NAME), eq(sql`lower(${users.email})`, DEMO_LEAD.email)));
  return rows.map((r) => r.id);
}

async function ensureUser(db: DbOrTx, email: string, name: string) {
  await db.insert(users).values({ email, name }).onConflictDoNothing();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
  if (!user) throw new Error(`demo user ${email} missing after insert`);
  return user.id;
}

export type DemoTeam = {
  teamId: string;
  /** Raw tokens by driver code. Held in memory only, never printed. */
  tokens: Map<string, string>;
  tokenIds: string[];
};

/**
 * Creates the Demo team (or reuses it) with the demo lead and five drivers, and gives every driver a
 * fresh token. `viewerEmail` adds an existing Race Control user as a lead, so they can watch the race.
 */
export async function setupDemoTeam(db: Database, options: { viewerEmail?: string; now: Date }): Promise<DemoTeam> {
  return db.transaction(async (tx) => {
    const leadId = await ensureUser(tx, DEMO_LEAD.email, DEMO_LEAD.name);
    const existing = await findDemoTeamIds(tx);
    let teamId = existing[0];
    if (!teamId) {
      const [team] = await tx.insert(teams).values({ name: DEMO_TEAM_NAME }).returning({ id: teams.id });
      teamId = team!.id;
      await tx.insert(memberships).values({ teamId, userId: leadId, role: 'lead' });
    }

    // The starter rules, with the .env rule enforced so the race shows a blocked edit.
    if ((await tx.$count(rules, eq(rules.teamId, teamId))) === 0) {
      await seedStarterRules(tx, teamId, options.now);
      await tx
        .update(rules)
        .set({ mode: 'enforce' })
        .where(and(eq(rules.teamId, teamId), eq(rules.pattern, '**/.env*')));
    }

    if (options.viewerEmail) {
      const email = options.viewerEmail.trim().toLowerCase();
      const [viewer] = await tx.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email));
      if (!viewer) {
        throw new SimulatorSetupError(`No Race Control user with the email ${email}. Sign in once, then run this again.`);
      }
      await tx.insert(memberships).values({ teamId, userId: viewer.id, role: 'lead' }).onConflictDoNothing();
    }

    const tokens = new Map<string, string>();
    const tokenIds: string[] = [];
    for (const driver of DRIVERS) {
      const userId = await ensureUser(tx, driver.email, driver.name);
      await tx.insert(memberships).values({ teamId, userId, role: 'developer' }).onConflictDoNothing();
      const token = createSecureToken(DEV_TOKEN_PREFIX);
      const [row] = await tx
        .insert(devTokens)
        .values({ teamId, userId, tokenHash: hashToken(token), label: 'Simulator', createdAt: options.now })
        .returning({ id: devTokens.id });
      tokens.set(driver.code, token);
      tokenIds.push(row!.id);
    }
    return { teamId, tokens, tokenIds };
  });
}

/** Revokes the tokens a run created, so none are left behind. */
export async function revokeSimulatorTokens(db: Database, tokenIds: string[], now: Date) {
  if (tokenIds.length === 0) return;
  await db.update(devTokens).set({ revokedAt: now }).where(inArray(devTokens.id, tokenIds));
}

/** Deletes the Demo team (with its sessions and events) and the demo users. Touches nothing else. */
export async function resetDemo(db: Database): Promise<{ teams: number; users: number }> {
  return db.transaction(async (tx) => {
    const teamIds = await findDemoTeamIds(tx);
    if (teamIds.length > 0) await tx.delete(teams).where(inArray(teams.id, teamIds));
    const removed = await tx
      .delete(users)
      .where(like(sql`lower(${users.email})`, `%@${DEMO_DOMAIN}`))
      .returning({ id: users.id });
    return { teams: teamIds.length, users: removed.length };
  });
}
