import { STARTER_RULES } from '@race-control/shared';
import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { rules } from '../../db/schema.ts';
import type { MatchableRule } from './match.ts';

/** A team's enabled rules. */
export async function listEnabledRules(db: DbOrTx, teamId: string): Promise<MatchableRule[]> {
  return db
    .select({
      id: rules.id,
      name: rules.name,
      tool: rules.tool,
      pattern: rules.pattern,
      action: rules.action,
      mode: rules.mode,
      enabled: rules.enabled,
      createdAt: rules.createdAt,
    })
    .from(rules)
    .where(and(eq(rules.teamId, teamId), eq(rules.enabled, true)))
    .orderBy(rules.createdAt, rules.id);
}

/** Adds the starter rules to a new team, all in shadow mode. */
export async function seedStarterRules(db: DbOrTx, teamId: string, now: Date) {
  await db.insert(rules).values(
    // A millisecond apart, so they keep this order.
    STARTER_RULES.map((rule, i) => ({ ...rule, teamId, mode: 'shadow' as const, createdAt: new Date(now.getTime() + i) })),
  );
}
