import type { Approval, ApprovalStatus, EventDecision } from '@race-control/shared';
import { and, desc, eq, gte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '../../db/client.ts';
import { approvals, events, rules, sessions, users } from '../../db/schema.ts';

export async function insertApproval(
  db: DbOrTx,
  values: { teamId: string; sessionId: string; eventId: string; ruleId: string; now: Date },
): Promise<string> {
  const [row] = await db
    .insert(approvals)
    .values({ teamId: values.teamId, sessionId: values.sessionId, eventId: values.eventId, ruleId: values.ruleId, requestedAt: values.now })
    .returning({ id: approvals.id });
  return row!.id;
}

const decider = alias(users, 'decider');

/** Approvals as the dashboard shows them, joined with who, what and which rule. Always scoped to one team. */
function selectApprovals(db: DbOrTx, teamId: string, filter?: SQL) {
  return db
    .select({
      id: approvals.id,
      sessionId: approvals.sessionId,
      eventId: approvals.eventId,
      status: approvals.status,
      ruleId: approvals.ruleId,
      ruleName: rules.name,
      userId: sessions.userId,
      userEmail: users.email,
      userName: users.name,
      agent: sessions.agent,
      repoName: sessions.repoName,
      toolName: events.toolName,
      target: events.target,
      summary: events.summary,
      requestedAt: approvals.requestedAt,
      decidedAt: approvals.decidedAt,
      deciderId: decider.id,
      deciderName: decider.name,
      deciderEmail: decider.email,
    })
    .from(approvals)
    .innerJoin(sessions, and(eq(sessions.teamId, approvals.teamId), eq(sessions.id, approvals.sessionId)))
    .innerJoin(events, and(eq(events.teamId, approvals.teamId), eq(events.id, approvals.eventId)))
    .innerJoin(rules, and(eq(rules.teamId, approvals.teamId), eq(rules.id, approvals.ruleId)))
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(decider, eq(decider.id, approvals.decidedBy))
    .where(and(eq(approvals.teamId, teamId), filter))
    .$dynamic();
}

type ApprovalRow = Awaited<ReturnType<ReturnType<typeof selectApprovals>['execute']>>[number];

export function serializeApproval(row: ApprovalRow, waitMs: number): Approval {
  const { deciderId, deciderName, deciderEmail, ...rest } = row;
  return {
    ...rest,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: new Date(row.requestedAt.getTime() + waitMs).toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: deciderId ? { userId: deciderId, name: deciderName ?? deciderEmail!.split('@')[0]! } : null,
  };
}

export async function findApproval(db: DbOrTx, teamId: string, approvalId: string): Promise<ApprovalRow | undefined> {
  const [row] = await selectApprovals(db, teamId, eq(approvals.id, approvalId));
  return row;
}

/** Pending approvals, and those decided since `since`. Newest first. */
export async function listApprovals(db: DbOrTx, teamId: string, since: Date): Promise<ApprovalRow[]> {
  return selectApprovals(db, teamId, or(eq(approvals.status, 'pending'), gte(approvals.requestedAt, since)))
    .orderBy(desc(approvals.requestedAt))
    .limit(100);
}

/**
 * Settles a pending approval. Only the first answer counts: returns false if it was already decided
 * or expired.
 */
export async function settleApproval(
  db: DbOrTx,
  teamId: string,
  approvalId: string,
  status: Exclude<ApprovalStatus, 'pending'>,
  decidedBy: string | null,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(approvals)
    .set({ status, decidedAt: now, decidedBy })
    .where(and(eq(approvals.teamId, teamId), eq(approvals.id, approvalId), eq(approvals.status, 'pending')))
    .returning({ id: approvals.id });
  return rows.length > 0;
}

/** Held requests don't survive a restart, so their approvals can never be answered. */
export async function expireAllPending(db: DbOrTx, now: Date) {
  await db.update(approvals).set({ status: 'expired', decidedAt: now }).where(eq(approvals.status, 'pending'));
  await db.update(events).set({ decision: 'deny' }).where(eq(events.decision, 'pending'));
}

/** Records the outcome on the held event, so its timeline step shows it. */
export async function updateEventOutcome(
  db: DbOrTx,
  teamId: string,
  eventId: string,
  decision: EventDecision,
  approval: { status: ApprovalStatus; by: string | null },
) {
  await db
    .update(events)
    .set({ decision, payloadRedacted: sql`${events.payloadRedacted} || ${JSON.stringify({ approval })}::jsonb` })
    .where(and(eq(events.teamId, teamId), eq(events.id, eventId)));
}
