import { STARTER_RULES, type RuleInput, type RuleUpdate } from '@race-control/shared';
import { and, desc, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.ts';
import { events, rules } from '../../db/schema.ts';
import type { MatchableRule } from './match.ts';

const ruleColumns = {
  id: rules.id,
  name: rules.name,
  tool: rules.tool,
  pattern: rules.pattern,
  action: rules.action,
  mode: rules.mode,
  enabled: rules.enabled,
  createdAt: rules.createdAt,
};

/** A team's rules, oldest first. */
export async function listRules(db: DbOrTx, teamId: string): Promise<MatchableRule[]> {
  return db.select(ruleColumns).from(rules).where(eq(rules.teamId, teamId)).orderBy(rules.createdAt, rules.id);
}

/** A team's enabled rules. */
export async function listEnabledRules(db: DbOrTx, teamId: string): Promise<MatchableRule[]> {
  return db
    .select(ruleColumns)
    .from(rules)
    .where(and(eq(rules.teamId, teamId), eq(rules.enabled, true)))
    .orderBy(rules.createdAt, rules.id);
}

export async function countRules(db: DbOrTx, teamId: string): Promise<number> {
  return db.$count(rules, eq(rules.teamId, teamId));
}

/** Adds a rule in shadow mode. */
export async function insertRule(db: DbOrTx, { now, ...values }: RuleInput & { teamId: string; createdBy: string; now: Date }) {
  const [row] = await db
    .insert(rules)
    .values({ ...values, mode: 'shadow', createdAt: now })
    .returning(ruleColumns);
  return row!;
}

/** Changes a team's rule. Undefined if the team has no such rule. */
export async function updateRule(db: DbOrTx, teamId: string, ruleId: string, values: RuleUpdate) {
  const [row] = await db
    .update(rules)
    .set(values)
    .where(and(eq(rules.teamId, teamId), eq(rules.id, ruleId)))
    .returning(ruleColumns);
  return row;
}

/** The rule decisions and shadow matches recorded on a team's events since `since`. */
export async function listRuleMatches(db: DbOrTx, teamId: string, since: Date) {
  return db
    .select({
      createdAt: events.createdAt,
      rule: sql<{ id?: string } | null>`${events.payloadRedacted} -> 'rule'`,
      shadow: sql<Array<{ id?: string }> | null>`${events.payloadRedacted} -> 'shadow'`,
    })
    .from(events)
    .where(
      and(
        eq(events.teamId, teamId),
        gte(events.createdAt, since),
        or(isNotNull(sql`${events.payloadRedacted} -> 'rule'`), isNotNull(sql`${events.payloadRedacted} -> 'shadow'`)),
      ),
    )
    .limit(20_000);
}

/** A team's latest tool calls since `since`: the tool and the stored (redacted) file path or command. */
export async function listRecentToolCalls(db: DbOrTx, teamId: string, since: Date) {
  return db
    .select({ toolName: events.toolName, target: events.target })
    .from(events)
    .where(
      and(
        eq(events.teamId, teamId),
        eq(events.type, 'PreToolUse'),
        isNotNull(events.toolName),
        isNotNull(events.target),
        gte(events.createdAt, since),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(5000);
}

/** Adds the starter rules to a new team, all in shadow mode. */
export async function seedStarterRules(db: DbOrTx, teamId: string, now: Date) {
  await db.insert(rules).values(
    // A millisecond apart, so they keep this order.
    STARTER_RULES.map((rule, i) => ({ ...rule, teamId, mode: 'shadow' as const, createdAt: new Date(now.getTime() + i) })),
  );
}
